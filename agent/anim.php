<?php
declare(strict_types=1);

// Load optional local/server environment overrides.
$envCandidates = [
    dirname(__DIR__) . "/config.php",
    __DIR__ . "/config.php"
];
foreach ($envCandidates as $envPath) {
    if (is_file($envPath)) {
        require $envPath;
        break;
    }
}

$openAiConnectTimeoutSeconds = max(3, (int) (getenv("OPENAI_CONNECT_TIMEOUT_SECONDS") ?: 10));
$openAiTimeoutSeconds = max($openAiConnectTimeoutSeconds + 5, (int) (getenv("OPENAI_TIMEOUT_SECONDS") ?: 120));
$openAiMaxAttempts = max(1, min(3, (int) (getenv("OPENAI_MAX_ATTEMPTS") ?: 2)));
$openAiRetryDelayMs = max(0, (int) (getenv("OPENAI_RETRY_DELAY_MS") ?: 1500));
$openAiMaxOutputTokens = max(512, (int) (getenv("OPENAI_MAX_OUTPUT_TOKENS") ?: 8000));

// Extend script execution time for slow upstream calls.
@set_time_limit(max(120, ($openAiTimeoutSeconds * $openAiMaxAttempts) + 30));

header("Content-Type: application/json; charset=utf-8");

// Validate request origin against allowed domain(s).
$allowedOrigins = getenv("PULSE_ALLOWED_ORIGIN");
$originAllowed = false;
if ($allowedOrigins) {
    $allowedOriginsList = array_map("trim", explode(",", $allowedOrigins));
    $requestOrigin = $_SERVER["HTTP_ORIGIN"] ?? null;
    
    if ($requestOrigin && in_array($requestOrigin, $allowedOriginsList, true)) {
        header("Access-Control-Allow-Origin: " . $requestOrigin);
        header("Vary: Origin");
        $originAllowed = true;
    }
} else {
    $originAllowed = true;
}

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    if ($originAllowed) {
        header("Access-Control-Allow-Methods: POST, OPTIONS");
        header("Access-Control-Allow-Headers: Content-Type, X-Pulse-Token");
        http_response_code(204);
        exit;
    } else {
        http_response_code(403);
        echo json_encode(["error" => "Origin not allowed"]);
        exit;
    }
}

// Reject POST requests from disallowed origins.
if ($allowedOrigins && !$originAllowed) {
    http_response_code(403);
    echo json_encode(["error" => "Origin not allowed"]);
    exit;
}

$sharedSecret = getenv("PULSE_SHARED_SECRET");
if ($sharedSecret) {
    $headers = function_exists("getallheaders") ? getallheaders() : [];
    $token = $headers["X-Pulse-Token"] ?? ($_SERVER["HTTP_X_PULSE_TOKEN"] ?? "");
    if (!is_string($token) || $token === "" || !hash_equals($sharedSecret, $token)) {
        http_response_code(401);
        echo json_encode(["error" => "Unauthorized"]);
        exit;
    }
}

$apiKey = getenv("OPENAI_API_KEY");
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(["error" => "Server misconfigured: missing OPENAI_API_KEY"]);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit;
}

$raw = file_get_contents("php://input");
if ($raw === false || $raw === "") {
    http_response_code(400);
    echo json_encode(["error" => "Missing request body"]);
    exit;
}

$payload = json_decode($raw, true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid JSON"]);
    exit;
}

$prompt = isset($payload["prompt"]) ? trim((string) $payload["prompt"]) : "";
if ($prompt === "") {
    http_response_code(400);
    echo json_encode(["error" => "Missing prompt"]);
    exit;
}

if (strlen($prompt) > 4000) {
    http_response_code(413);
    echo json_encode(["error" => "Prompt too long"]);
    exit;
}

$arcgisApiKey = getenv("ARCGIS_API_KEY");
$routeLineCoords = null;
$routeExtent = null;

function arcgis_request($url, $params, $apiKey) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/x-www-form-urlencoded"]);
    $params["f"] = $params["f"] ?? "json";
    $params["token"] = $apiKey;
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($body === false) {
        return [null, ["error" => curl_error($ch), "errno" => curl_errno($ch)]];
    }
    $data = json_decode($body, true);
    if (!is_array($data) || $code < 200 || $code >= 300) {
        return [null, ["error" => "request_failed", "status" => $code, "details" => $data]];
    }
    return [$data, null];
}

function sleep_ms(int $milliseconds): void {
    if ($milliseconds <= 0) {
        return;
    }
    usleep($milliseconds * 1000);
}

function is_retryable_openai_http_status(int $httpCode): bool {
    return $httpCode === 408 || $httpCode === 409 || $httpCode === 429 || $httpCode >= 500;
}

function is_retryable_curl_errno(int $errno): bool {
    return in_array($errno, [6, 7, 18, 28, 52, 55, 56], true);
}

function post_openai_responses_request(
    array $requestBody,
    string $apiKey,
    int $connectTimeoutSeconds,
    int $timeoutSeconds,
    int $maxAttempts,
    int $retryDelayMs
): array {
    $encodedBody = json_encode($requestBody);
    if (!is_string($encodedBody)) {
        return [null, 0, ["error" => "Failed to encode request body"], 0];
    }

    $lastError = null;
    $lastResponseBody = null;
    $lastHttpCode = 0;

    for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
        $ch = curl_init("https://api.openai.com/v1/responses");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: Bearer " . $apiKey,
            "Content-Type: application/json"
        ]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $encodedBody);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $connectTimeoutSeconds);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeoutSeconds);

        $responseBody = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $lastHttpCode = $httpCode;

        if ($responseBody !== false) {
            $lastResponseBody = $responseBody;
            if (!is_retryable_openai_http_status($httpCode) || $attempt === $maxAttempts) {
                return [$responseBody, $httpCode, null, $attempt];
            }
            sleep_ms($retryDelayMs);
            continue;
        }

        $errno = curl_errno($ch);
        $err = curl_error($ch);
        $lastError = [
            "curl_errno" => $errno,
            "curl_error" => $err,
            "attempt" => $attempt,
            "max_attempts" => $maxAttempts,
            "timeout_seconds" => $timeoutSeconds,
            "connect_timeout_seconds" => $connectTimeoutSeconds
        ];

        if ($attempt === $maxAttempts || !is_retryable_curl_errno($errno)) {
            return [null, $httpCode, $lastError, $attempt];
        }

        sleep_ms($retryDelayMs);
    }

    return [$lastResponseBody, $lastHttpCode, $lastError, $maxAttempts];
}

function geocode_place($name, $apiKey) {
    $url = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";
    $params = [
        "SingleLine" => $name,
        "maxLocations" => 1,
        "outSR" => 4326,
        "category" => "Address,Populated Place",
        "locationType" => "street"
    ];
    [$data, $err] = arcgis_request($url, $params, $apiKey);
    if ($err || !isset($data["candidates"][0]["location"])) {
        return [null, $err ?? ["error" => "no_candidates"]];
    }
    $loc = $data["candidates"][0]["location"];
    if (!isset($loc["x"], $loc["y"])) {
        return [null, ["error" => "invalid_location"]];
    }
    return [[(float) $loc["x"], (float) $loc["y"]], null];
}

function route_between($from, $to, $apiKey) {
    $url = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World/solve";
    $stops = $from[0] . "," . $from[1] . ";" . $to[0] . "," . $to[1];
    $params = [
        "stops" => $stops,
        "outSR" => 4326,
        "returnRoutes" => true,
        "returnDirections" => false,
        // Prefer true-shape output to avoid overly simplified lines.
        "outputLines" => "esriNAOutputLineTrueShape",
        "simplifyOutput" => "false"
    ];
    [$data, $err] = arcgis_request($url, $params, $apiKey);
    if ($err || !isset($data["routes"]["features"][0]["geometry"]["paths"])) {
        return [null, $err ?? ["error" => "no_route"]];
    }
    $paths = $data["routes"]["features"][0]["geometry"]["paths"];
    if (!is_array($paths) || !isset($paths[0])) {
        return [null, ["error" => "empty_paths"]];
    }
    return [$paths, null];
}

// Optional routing when the prompt asks for driving/route/directions.
if ($arcgisApiKey) {
    $wantsRoute = prompt_requests_route($prompt) && !prompt_requests_flight($prompt);
    if ($wantsRoute) {
        $fromToPairs = [];
        $previousTo = null;

        $lines = preg_split('/[\\r\\n]+|(?<=\\.)\\s+/u', $prompt);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '') continue;
            $line = preg_replace('/^\\s*\\d+\\.\\s*/', '', $line);
            $fromName = null;
            $toName = null;

            if (preg_match('/\bfrom\s+([^,.]+?)\s+to\s+([^,.]+?)(?:[\.,]|$)/i', $line, $m)) {
                $fromName = trim($m[1]);
                $toName = trim($m[2]);
            } elseif (preg_match('/\bdrive\s+([^,.]+?)\s+to\s+([^,.]+?)(?:[\.,]|$)/i', $line, $m)) {
                $fromName = trim($m[1]);
                $toName = trim($m[2]);
            } elseif (preg_match('/\bdrive\s+([^,.]+?)\s+back\s+to\s+([^,.]+?)(?:[\.,]|$)/i', $line, $m)) {
                $fromName = trim($m[1]);
                $toName = trim($m[2]);
            } elseif (preg_match('/\bback\s+to\s+([^,.]+?)(?:[\.,]|$)/i', $line, $m)) {
                $toName = trim($m[1]);
                if ($previousTo) {
                    $fromName = $previousTo;
                }
            } elseif (preg_match('/\bto\s+([^,.]+?)(?:\s+by|\s+drive|\s+driving|\s+route|\s+directions|[\.,]|$)/i', $line, $m)) {
                $toName = trim($m[1]);
                if ($previousTo) {
                    $fromName = $previousTo;
                }
            }

            if ($fromName && $toName) {
                $fromToPairs[] = [$fromName, $toName];
                $previousTo = $toName;
            } elseif ($toName) {
                $previousTo = $toName;
            }
        }

        // De-duplicate pairs.
        $uniquePairs = [];
        foreach ($fromToPairs as $pair) {
            $key = strtolower($pair[0] . '->' . $pair[1]);
            $uniquePairs[$key] = $pair;
        }
        $fromToPairs = array_values($uniquePairs);
        if (count($fromToPairs) > 5) {
            http_response_code(422);
            echo json_encode([
                "error" => "Too many routes in one request",
                "details" => [
                    "max_routes" => 5,
                    "found" => count($fromToPairs)
                ]
            ]);
            exit;
        }
        if (count($fromToPairs) === 0) {
            http_response_code(422);
            echo json_encode([
                "error" => "Routing requested but no routes were parsed",
                "details" => ["hint" => "Use 'drive from A to B' or 'drive A to B' in each line."]
            ]);
            exit;
        }

        $placeAliases = [
            "cornwall" => "Truro, Cornwall, UK",
            "devon" => "Exeter, Devon, UK",
            "dorset" => "Dorchester, Dorset, UK",
            "hemel hempstead" => "Hemel Hempstead, UK"
        ];

        $routes = [];
        $routeErrors = [];
        foreach ($fromToPairs as $pair) {
            [$fromName, $toName] = $pair;
            $fromKey = strtolower($fromName);
            $toKey = strtolower($toName);
            if (isset($placeAliases[$fromKey])) {
                $fromName = $placeAliases[$fromKey];
            }
            if (isset($placeAliases[$toKey])) {
                $toName = $placeAliases[$toKey];
            }
            [$fromCoord, $fromErr] = geocode_place($fromName, $arcgisApiKey);
            [$toCoord, $toErr] = geocode_place($toName, $arcgisApiKey);
            if (!$fromCoord || !$toCoord) {
                $routeErrors[] = [
                    "from" => $fromName,
                    "to" => $toName,
                    "error" => "geocode_failed",
                    "details" => ["fromErr" => $fromErr, "toErr" => $toErr]
                ];
                continue;
            }
            [$paths, $routeErr] = route_between($fromCoord, $toCoord, $arcgisApiKey);
            if ($paths && is_array($paths[0] ?? null)) {
                $routes[] = [
                    "from" => $fromName,
                    "to" => $toName,
                    "coords" => $paths[0]
                ];
            } else {
                $routeErrors[] = [
                    "from" => $fromName,
                    "to" => $toName,
                    "error" => "route_failed",
                    "details" => $routeErr
                ];
            }
        }
        if ($routes) {
            $routeLineCoords = $routes;
        } elseif ($wantsRoute) {
            http_response_code(422);
            echo json_encode([
                "error" => "Routing failed",
                "details" => $routeErrors
            ]);
            exit;
        }
    }
}
// Optional APCu rate limiting (best-effort, no disk persistence).
$rateLimitMax = 30;
$rateLimitWindow = 300;
$clientIp = $_SERVER["REMOTE_ADDR"] ?? "unknown";
if (function_exists("apcu_fetch")) {
    $rateKey = "pulse:anim:rl:" . $clientIp;
    $current = apcu_fetch($rateKey);
    if (!is_array($current)) {
        $current = ["count" => 0, "reset" => time() + $rateLimitWindow];
    }
    if (time() > (int) $current["reset"]) {
        $current = ["count" => 0, "reset" => time() + $rateLimitWindow];
    }
    $current["count"]++;
    apcu_store($rateKey, $current, $rateLimitWindow);
    if ($current["count"] > $rateLimitMax) {
        http_response_code(429);
        echo json_encode([
            "error" => "Rate limit exceeded",
            "retry_after" => max(1, (int) $current["reset"] - time())
        ]);
        exit;
    }
}

$model = getenv("OPENAI_MODEL") ?: "gpt-5.4-mini";
header("X-OpenAI-Model: " . $model);

$schema = [
    "type" => "object",
    "additionalProperties" => false,
    "properties" => [
        "type" => ["type" => "string", "enum" => ["FeatureCollection"]],
        "features" => [
            "type" => "array",
            "items" => [
                "type" => "object",
                "additionalProperties" => false,
                "properties" => [
                    "type" => ["type" => "string", "enum" => ["Feature"]],
                    "geometry" => [
                        "type" => "object",
                        "additionalProperties" => false,
                        "properties" => [
                            "type" => ["type" => "string"],
                            "coordinates" => [
                                "anyOf" => [
                                    [
                                        "type" => "array",
                                        "items" => ["type" => "number"]
                                    ],
                                    [
                                        "type" => "array",
                                        "items" => [
                                            "type" => "array",
                                            "items" => ["type" => "number"]
                                        ]
                                    ],
                                    [
                                        "type" => "array",
                                        "items" => [
                                            "type" => "array",
                                            "items" => [
                                                "type" => "array",
                                                "items" => ["type" => "number"]
                                            ]
                                        ]
                                    ],
                                    [
                                        "type" => "array",
                                        "items" => [
                                            "type" => "array",
                                            "items" => [
                                                "type" => "array",
                                                "items" => [
                                                    "type" => "array",
                                                    "items" => ["type" => "number"]
                                                ]
                                            ]
                                        ]
                                    ]
                                ]
                            ]
                        ],
                        "required" => ["type", "coordinates"]
                    ],
                    "properties" => [
                        "type" => "object",
                        "additionalProperties" => false,
                        "properties" => [
                            "_pulse" => [
                                "type" => "object",
                                "additionalProperties" => false,
                                "properties" => [
                                    "layerId" => ["type" => "string"]
                                ],
                                "required" => ["layerId"]
                            ]
                        ],
                        "required" => ["_pulse"]
                    ]
                ],
                "required" => ["type", "geometry", "properties"]
            ]
        ],
        "properties" => [
            "type" => "object",
            "additionalProperties" => false,
            "properties" => [
                "_pulse" => [
                    "type" => "object",
                    "additionalProperties" => false,
                    "properties" => [
                        "version" => ["type" => "integer"],
                        "savedAt" => ["type" => "string"],
                        "projectName" => ["type" => ["string", "null"]],
                        "spatialReference" => [
                            "anyOf" => [
                                [
                                    "type" => "object",
                                    "additionalProperties" => false,
                                    "properties" => [
                                        "wkid" => ["type" => ["integer", "null"]]
                                    ],
                                    "required" => ["wkid"]
                                ],
                                [
                                    "type" => "null"
                                ]
                            ]
                        ],
                        "app" => [
                            "type" => "object",
                            "additionalProperties" => false,
                            "properties" => [
                                "layout" => ["type" => "string", "enum" => ["default", "mobile", "tablet", "custom"]],
                                "customWidth" => ["type" => ["number", "null"]],
                                "customHeight" => ["type" => ["number", "null"]],
                                "isRotated" => ["type" => "boolean"],
                                "basemap" => ["type" => "string"],
                                "basemapVisible" => ["type" => "boolean"],
                                "basemapLabelsVisible" => ["type" => ["boolean", "null"]],
                                "google3DTilesEnabled" => ["type" => ["boolean", "null"]],
                                "viewTrackKeyframes" => [
                                    "anyOf" => [
                                        [
                                            "type" => "array",
                                            "items" => [
                                                "type" => "object",
                                                "additionalProperties" => false,
                                                "properties" => [
                                                    "time" => ["type" => "number"],
                                                    "x" => ["type" => "number"],
                                                    "y" => ["type" => "number"],
                                                    "z" => ["type" => ["number", "null"]],
                                                    "heading" => ["type" => ["number", "null"]],
                                                    "tilt" => ["type" => ["number", "null"]],
                                                    "fov" => ["type" => ["number", "null"]],
                                                    "rotation" => ["type" => ["number", "null"]],
                                                    "scale" => ["type" => ["number", "null"]],
                                                    "easing" => [
                                                        "type" => ["string", "null"],
                                                        "enum" => ["linear", "ease-in", "ease-out", "ease-in-out", null]
                                                    ],
                                                    "spatialReference" => [
                                                        "anyOf" => [
                                                            [
                                                                "type" => "object",
                                                                "additionalProperties" => false,
                                                                "properties" => [
                                                                    "wkid" => ["type" => ["integer", "null"]],
                                                                    "latestWkid" => ["type" => ["integer", "null"]]
                                                                ],
                                                                "required" => ["wkid", "latestWkid"]
                                                            ],
                                                            [
                                                                "type" => "null"
                                                            ]
                                                        ]
                                                    ]
                                                ],
                                                "required" => [
                                                    "time",
                                                    "x",
                                                    "y",
                                                    "z",
                                                    "heading",
                                                    "tilt",
                                                    "fov",
                                                    "rotation",
                                                    "scale",
                                                    "easing",
                                                    "spatialReference"
                                                ]
                                            ]
                                        ],
                                        [
                                            "type" => "null"
                                        ]
                                    ]
                                ],
                                "backgroundColor" => ["type" => ["string", "null"]],
                                "backgroundTransparent" => ["type" => ["boolean", "null"]],
                                "mode" => [
                                    "anyOf" => [
                                        [
                                            "type" => "string",
                                            "enum" => ["2d", "3d"]
                                        ],
                                        [
                                            "type" => "null"
                                        ]
                                    ]
                                ],
                                "scene" => [
                                    "anyOf" => [
                                        [
                                            "type" => "object",
                                            "additionalProperties" => false,
                                            "properties" => [
                                                "cameraStudio" => [
                                                    "anyOf" => [
                                                        [
                                                            "type" => "object",
                                                            "additionalProperties" => false,
                                                            "properties" => [
                                                                "fov" => ["type" => ["number", "null"]],
                                                                "qualityProfile" => [
                                                                    "type" => ["string", "null"],
                                                                    "enum" => ["low", "medium", "high", null]
                                                                ],
                                                                "atmosphereQuality" => [
                                                                    "type" => ["string", "null"],
                                                                    "enum" => ["low", "high", null]
                                                                ],
                                                                "glowEnabled" => ["type" => ["boolean", "null"]],
                                                                "glowIntensity" => ["type" => ["number", "null"]],
                                                                "cinematicFxEnabled" => ["type" => ["boolean", "null"]],
                                                                "exposure" => ["type" => ["number", "null"]],
                                                                "contrast" => ["type" => ["number", "null"]],
                                                                "saturation" => ["type" => ["number", "null"]],
                                                                "letterbox" => ["type" => ["number", "null"]],
                                                                "noiseLevel" => ["type" => ["number", "null"]],
                                                                "scanlineLevel" => ["type" => ["number", "null"]],
                                                                "vignetteLevel" => ["type" => ["number", "null"]],
                                                                "jitter" => ["type" => ["number", "null"]],
                                                                "chromaticAberration" => ["type" => ["number", "null"]]
                                                            ],
                                                            "required" => [
                                                                "fov",
                                                                "qualityProfile",
                                                                "atmosphereQuality",
                                                                "glowEnabled",
                                                                "glowIntensity",
                                                                "cinematicFxEnabled",
                                                                "exposure",
                                                                "contrast",
                                                                "saturation",
                                                                "letterbox",
                                                                "noiseLevel",
                                                                "scanlineLevel",
                                                                "vignetteLevel",
                                                                "jitter",
                                                                "chromaticAberration"
                                                            ]
                                                        ],
                                                        [
                                                            "type" => "null"
                                                        ]
                                                    ]
                                                ],
                                                "lighting" => [
                                                    "anyOf" => [
                                                        [
                                                            "type" => "object",
                                                            "additionalProperties" => false,
                                                            "properties" => [
                                                                "type" => [
                                                                    "type" => ["string", "null"],
                                                                    "enum" => ["sun", "virtual", null]
                                                                ],
                                                                "date" => ["type" => ["string", "null"]],
                                                                "displayUTCOffset" => ["type" => ["number", "null"]],
                                                                "directShadowsEnabled" => ["type" => ["boolean", "null"]],
                                                                "glowIntensity" => ["type" => ["number", "null"]]
                                                            ],
                                                            "required" => [
                                                                "type",
                                                                "date",
                                                                "displayUTCOffset",
                                                                "directShadowsEnabled",
                                                                "glowIntensity"
                                                            ]
                                                        ],
                                                        [
                                                            "type" => "null"
                                                        ]
                                                    ]
                                                ]
                                            ],
                                            "required" => ["cameraStudio", "lighting"]
                                        ],
                                        [
                                            "type" => "null"
                                        ]
                                    ]
                                ],
                                "camera" => [
                                    "anyOf" => [
                                        [
                                            "type" => "object",
                                            "additionalProperties" => false,
                                            "properties" => [
                                                "position" => [
                                                    "type" => "object",
                                                    "additionalProperties" => false,
                                                    "properties" => [
                                                        "x" => ["type" => "number"],
                                                        "y" => ["type" => "number"],
                                                        "z" => ["type" => "number"],
                                                        "spatialReference" => [
                                                            "anyOf" => [
                                                                [
                                                                    "type" => "object",
                                                                    "additionalProperties" => false,
                                                                    "properties" => [
                                                                        "wkid" => ["type" => ["integer", "null"]],
                                                                        "latestWkid" => ["type" => ["integer", "null"]]
                                                                    ],
                                                                    "required" => ["wkid", "latestWkid"]
                                                                ],
                                                                [
                                                                    "type" => "null"
                                                                ]
                                                            ]
                                                        ]
                                                    ],
                                                    "required" => ["x", "y", "z", "spatialReference"]
                                                ],
                                                "heading" => ["type" => "number"],
                                                "tilt" => ["type" => "number"]
                                            ],
                                            "required" => ["position", "heading", "tilt"]
                                        ],
                                        [
                                            "type" => "null"
                                        ]
                                    ]
                                ],
                                "extent" => [
                                    "anyOf" => [
                                        [
                                            "type" => "object",
                                            "additionalProperties" => false,
                                            "properties" => [
                                                "xmin" => ["type" => "number"],
                                                "ymin" => ["type" => "number"],
                                                "xmax" => ["type" => "number"],
                                                "ymax" => ["type" => "number"],
                                                "wkid" => ["type" => ["integer", "null"]]
                                            ],
                                            "required" => ["xmin", "ymin", "xmax", "ymax", "wkid"]
                                        ],
                                        [
                                            "type" => "null"
                                        ]
                                    ]
                                ]
                            ],
                            "required" => [
                                "layout",
                                "customWidth",
                                "customHeight",
                                "isRotated",
                                "basemap",
                                "basemapVisible",
                                "basemapLabelsVisible",
                                "google3DTilesEnabled",
                                "viewTrackKeyframes",
                                "backgroundColor",
                                "backgroundTransparent",
                                "mode",
                                "scene",
                                "camera",
                                "extent"
                            ]
                        ],
                        "timeline" => [
                            "type" => "object",
                            "additionalProperties" => false,
                            "properties" => [
                                "durationOverride" => ["type" => ["number", "null"]]
                            ],
                            "required" => ["durationOverride"]
                        ],
                        "layers" => [
                            "type" => "array",
                            "items" => [
                                "type" => "object",
                                "additionalProperties" => false,
                                "properties" => [
                                    "id" => ["type" => "string"],
                                    "name" => ["type" => "string"],
                                    "type" => [
                                        "type" => "string",
                                        "enum" => ["point", "polyline", "polygon", "text", "feature", "particles", "volume"]
                                    ],
                                    "animations" => [
                                        "type" => "array",
                                        "items" => [
                                            "anyOf" => [
                                                [
                                                    "type" => "object",
                                                    "additionalProperties" => false,
                                                    "properties" => [
                                                        "type" => [
                                                            "type" => "string",
                                                            "enum" => [
                                                                "fadeIn",
                                                                "fadeOut",
                                                                "pulse",
                                                                "bounce",
                                                                "spin",
                                                                "grow",
                                                                "draw",
                                                                "drawReverse",
                                                                "fill",
                                                                "typewriter",
                                                                "field",
                                                                "smoke",
                                                                "fire"
                                                            ]
                                                        ],
                                                        "duration" => ["type" => "number"],
                                                        "start" => ["type" => "number"]
                                                    ],
                                                    "required" => ["type", "duration", "start"]
                                                ],
                                                [
                                                    "type" => "object",
                                                    "additionalProperties" => false,
                                                    "properties" => [
                                                        "type" => ["type" => "string", "enum" => ["followPath"]],
                                                        "duration" => ["type" => "number"],
                                                        "start" => ["type" => "number"],
                                                        "pathLayerId" => ["type" => "string"],
                                                        "orientToPath" => ["type" => "boolean"],
                                                        "reverse" => ["type" => "boolean"],
                                                        "smoothFollow" => ["type" => "boolean"]
                                                    ],
                                                    "required" => [
                                                        "type",
                                                        "duration",
                                                        "start",
                                                        "pathLayerId",
                                                        "orientToPath",
                                                        "reverse",
                                                        "smoothFollow"
                                                    ]
                                                ]
                                            ]
                                        ]
                                    ],
                                    "pointKeyframes" => [
                                        "anyOf" => [
                                            [
                                                "type" => "array",
                                                "items" => [
                                                    "type" => "object",
                                                    "additionalProperties" => false,
                                                    "properties" => [
                                                        "time" => ["type" => "number"],
                                                        "x" => ["type" => "number"],
                                                        "y" => ["type" => "number"],
                                                        "z" => ["type" => ["number", "null"]],
                                                        "heading" => ["type" => ["number", "null"]],
                                                        "tilt" => ["type" => ["number", "null"]],
                                                        "fov" => ["type" => ["number", "null"]],
                                                        "easing" => [
                                                            "type" => ["string", "null"],
                                                            "enum" => ["linear", "ease-in", "ease-out", "ease-in-out", null]
                                                        ],
                                                        "spatialReference" => [
                                                            "anyOf" => [
                                                                [
                                                                    "type" => "object",
                                                                    "additionalProperties" => false,
                                                                    "properties" => [
                                                                        "wkid" => ["type" => ["integer", "null"]],
                                                                        "latestWkid" => ["type" => ["integer", "null"]]
                                                                    ],
                                                                    "required" => ["wkid", "latestWkid"]
                                                                ],
                                                                [
                                                                    "type" => "null"
                                                                ]
                                                            ]
                                                        ]
                                                    ],
                                                    "required" => [
                                                        "time",
                                                        "x",
                                                        "y",
                                                        "z",
                                                        "heading",
                                                        "tilt",
                                                        "fov",
                                                        "easing",
                                                        "spatialReference"
                                                    ]
                                                ]
                                            ],
                                            [
                                                "type" => "null"
                                            ]
                                        ]
                                    ],
                                    "pointStyle" => [
                                        "anyOf" => [
                                            [
                                                "type" => "object",
                                                "additionalProperties" => false,
                                                "properties" => [
                                                    "style" => [
                                                        "type" => "string",
                                                        "enum" => [
                                                            "circle",
                                                            "square",
                                                            "diamond",
                                                            "triangle",
                                                            "cross",
                                                            "x",
                                                            "home",
                                                            "map-pin",
                                                            "star",
                                                            "hexagon",
                                                            "pentagon",
                                                            "octagon",
                                                            "heart",
                                                            "drop",
                                                            "shield",
                                                            "flag",
                                                            "phosphor-map-pin",
                                                            "phosphor-map-pin-line",
                                                            "phosphor-map-pin-plus",
                                                            "phosphor-map-pin-simple",
                                                            "phosphor-map-pin-simple-line",
                                                            "phosphor-map-trifold",
                                                            "phosphor-navigation-arrow",
                                                            "phosphor-compass",
                                                            "phosphor-compass-rose",
                                                            "phosphor-crosshair",
                                                            "phosphor-crosshair-simple",
                                                            "phosphor-push-pin",
                                                            "phosphor-push-pin-simple",
                                                            "phosphor-push-pin-slash",
                                                            "phosphor-push-pin-simple-slash",
                                                            "phosphor-path",
                                                            "phosphor-flag",
                                                            "phosphor-flag-banner",
                                                            "phosphor-flag-checkered",
                                                            "phosphor-flag-pennant",
                                                            "phosphor-car",
                                                            "phosphor-car-simple",
                                                            "phosphor-taxi",
                                                            "phosphor-bus",
                                                            "phosphor-train",
                                                            "phosphor-tram",
                                                            "phosphor-subway",
                                                            "phosphor-airplane",
                                                            "phosphor-airplane-landing",
                                                            "phosphor-airplane-takeoff",
                                                            "phosphor-bicycle",
                                                            "phosphor-motorcycle",
                                                            "phosphor-scooter",
                                                            "phosphor-boat",
                                                            "phosphor-truck",
                                                            "phosphor-van",
                                                            "phosphor-cable-car",
                                                            "phosphor-anchor",
                                                            "phosphor-lifebuoy",
                                                            "phosphor-lighthouse",
                                                            "phosphor-house",
                                                            "phosphor-house-simple",
                                                            "phosphor-building",
                                                            "phosphor-building-office",
                                                            "phosphor-buildings",
                                                            "phosphor-hospital",
                                                            "phosphor-student",
                                                            "phosphor-graduation-cap",
                                                            "phosphor-police-car",
                                                            "phosphor-fire-truck",
                                                            "model-car",
                                                            "model-bus",
                                                            "model-train",
                                                            "model-boat",
                                                            "model-airplane",
                                                            "phosphor-church",
                                                            "phosphor-bank",
                                                            "phosphor-gas-pump",
                                                            "phosphor-charging-station",
                                                            "phosphor-plug-charging",
                                                            "phosphor-coffee",
                                                            "phosphor-bowl-food",
                                                            "phosphor-fork-knife",
                                                            "phosphor-park",
                                                            "phosphor-tree",
                                                            "phosphor-mountains",
                                                            "phosphor-bridge",
                                                            "phosphor-tent",
                                                            "phosphor-bed",
                                                            "phosphor-number-circle-zero",
                                                            "phosphor-number-circle-one",
                                                            "phosphor-number-circle-two",
                                                            "phosphor-number-circle-three",
                                                            "phosphor-number-circle-four",
                                                            "phosphor-number-circle-five",
                                                            "phosphor-number-circle-six",
                                                            "phosphor-number-circle-seven",
                                                            "phosphor-number-circle-eight",
                                                            "phosphor-number-circle-nine"
                                                        ]
                                                    ],
                                                    "size" => ["type" => "number"],
                                                    "color" => ["type" => "string"],
                                                    "outlineColor" => ["type" => "string"],
                                                    "outlineWidth" => ["type" => "number"],
                                                    "angle" => ["type" => "number"],
                                                    "xoffset" => ["type" => "number"],
                                                    "yoffset" => ["type" => "number"]
                                                ],
                                                "required" => [
                                                    "style",
                                                    "size",
                                                    "color",
                                                    "outlineColor",
                                                    "outlineWidth",
                                                    "angle",
                                                    "xoffset",
                                                    "yoffset"
                                                ]
                                            ],
                                            [
                                                "type" => "null"
                                            ]
                                        ]
                                    ],
                                    "lineStyle" => [
                                        "anyOf" => [
                                            [
                                                "type" => "object",
                                                "additionalProperties" => false,
                                                "properties" => [
                                                    "style" => [
                                                        "type" => "string",
                                                        "enum" => [
                                                            "solid",
                                                            "arrow-start",
                                                            "arrow-end",
                                                            "arrow-both",
                                                            "dash",
                                                            "dot",
                                                            "dash-dot",
                                                            "short-dash",
                                                            "short-dot",
                                                            "short-dash-dot",
                                                            "short-dash-dot-dot",
                                                            "long-dash",
                                                            "long-dash-dot",
                                                            "tube-3d"
                                                        ]
                                                    ],
                                                    "width" => ["type" => "number"],
                                                    "color" => ["type" => "string"]
                                                ],
                                                "required" => ["style", "width", "color"]
                                            ],
                                            [
                                                "type" => "null"
                                            ]
                                        ]
                                    ],
                                    "polygonStyle" => [
                                        "anyOf" => [
                                            [
                                                "type" => "object",
                                                "additionalProperties" => false,
                                                "properties" => [
                                                    "style" => [
                                                        "type" => "string",
                                                        "enum" => [
                                                            "solid",
                                                            "backward-diagonal",
                                                            "forward-diagonal",
                                                            "diagonal-cross",
                                                            "cross",
                                                            "horizontal",
                                                            "vertical",
                                                            "none"
                                                        ]
                                                    ],
                                                    "color" => ["type" => "string"],
                                                    "outlineColor" => ["type" => "string"],
                                                    "outlineWidth" => ["type" => "number"],
                                                    "outlineStyle" => [
                                                        "type" => "string",
                                                        "enum" => [
                                                            "solid",
                                                            "dash",
                                                            "dot",
                                                            "dash-dot",
                                                            "short-dash",
                                                            "short-dot",
                                                            "short-dash-dot",
                                                            "short-dash-dot-dot",
                                                            "long-dash",
                                                            "long-dash-dot"
                                                        ]
                                                    ]
                                                ],
                                                "required" => [
                                                    "style",
                                                    "color",
                                                    "outlineColor",
                                                    "outlineWidth",
                                                    "outlineStyle"
                                                ]
                                            ],
                                            [
                                                "type" => "null"
                                            ]
                                        ]
                                    ],
                                    "particleStyle" => [
                                        "anyOf" => [
                                            [
                                                "type" => "object",
                                                "additionalProperties" => false,
                                                "properties" => [
                                                    "width" => ["type" => "number"],
                                                    "depth" => ["type" => "number"],
                                                    "height" => ["type" => "number"],
                                                    "floorOffset" => ["type" => "number"],
                                                    "opacity" => ["type" => "number"],
                                                    "slices" => ["type" => "number"],
                                                    "color" => ["type" => "string"],
                                                    "edgeColor" => ["type" => "string"],
                                                    "preset" => [
                                                        "type" => ["string", "null"],
                                                        "enum" => [
                                                            "balanced",
                                                            "bonfire",
                                                            "jet-flame",
                                                            "heavy-smoke",
                                                            "steam-vent",
                                                            "dust-plume",
                                                            null
                                                        ]
                                                    ],
                                                    "emitterMode" => [
                                                        "type" => ["string", "null"],
                                                        "enum" => ["box", "emitter", null]
                                                    ],
                                                    "emitterRadius" => ["type" => ["number", "null"]],
                                                    "fireLifetime" => ["type" => ["number", "null"]],
                                                    "smokeLifetime" => ["type" => ["number", "null"]],
                                                    "fireSpeed" => ["type" => ["number", "null"]],
                                                    "smokeSpeed" => ["type" => ["number", "null"]],
                                                    "variation" => ["type" => ["number", "null"]],
                                                    "turbulence" => ["type" => ["number", "null"]],
                                                    "windX" => ["type" => ["number", "null"]],
                                                    "windY" => ["type" => ["number", "null"]],
                                                    "buoyancy" => ["type" => ["number", "null"]]
                                                ],
                                                "required" => [
                                                    "width",
                                                    "depth",
                                                    "height",
                                                    "floorOffset",
                                                    "opacity",
                                                    "slices",
                                                    "color",
                                                    "edgeColor",
                                                    "preset",
                                                    "emitterMode",
                                                    "emitterRadius",
                                                    "fireLifetime",
                                                    "smokeLifetime",
                                                    "fireSpeed",
                                                    "smokeSpeed",
                                                    "variation",
                                                    "turbulence",
                                                    "windX",
                                                    "windY",
                                                    "buoyancy"
                                                ]
                                            ],
                                            [
                                                "type" => "null"
                                            ]
                                        ]
                                    ],
                                    "volumeStyle" => [
                                        "anyOf" => [
                                            [
                                                "type" => "object",
                                                "additionalProperties" => false,
                                                "properties" => [
                                                    "width" => ["type" => "number"],
                                                    "depth" => ["type" => "number"],
                                                    "height" => ["type" => "number"],
                                                    "floorOffset" => ["type" => "number"],
                                                    "opacity" => ["type" => "number"],
                                                    "slices" => ["type" => "number"],
                                                    "color" => ["type" => "string"],
                                                    "edgeColor" => ["type" => "string"],
                                                    "preset" => [
                                                        "type" => ["string", "null"],
                                                        "enum" => [
                                                            "balanced",
                                                            "bonfire",
                                                            "jet-flame",
                                                            "heavy-smoke",
                                                            "steam-vent",
                                                            "dust-plume",
                                                            null
                                                        ]
                                                    ],
                                                    "emitterMode" => [
                                                        "type" => ["string", "null"],
                                                        "enum" => ["box", "emitter", null]
                                                    ],
                                                    "emitterRadius" => ["type" => ["number", "null"]],
                                                    "fireLifetime" => ["type" => ["number", "null"]],
                                                    "smokeLifetime" => ["type" => ["number", "null"]],
                                                    "fireSpeed" => ["type" => ["number", "null"]],
                                                    "smokeSpeed" => ["type" => ["number", "null"]],
                                                    "variation" => ["type" => ["number", "null"]],
                                                    "turbulence" => ["type" => ["number", "null"]],
                                                    "windX" => ["type" => ["number", "null"]],
                                                    "windY" => ["type" => ["number", "null"]],
                                                    "buoyancy" => ["type" => ["number", "null"]]
                                                ],
                                                "required" => [
                                                    "width",
                                                    "depth",
                                                    "height",
                                                    "floorOffset",
                                                    "opacity",
                                                    "slices",
                                                    "color",
                                                    "edgeColor",
                                                    "preset",
                                                    "emitterMode",
                                                    "emitterRadius",
                                                    "fireLifetime",
                                                    "smokeLifetime",
                                                    "fireSpeed",
                                                    "smokeSpeed",
                                                    "variation",
                                                    "turbulence",
                                                    "windX",
                                                    "windY",
                                                    "buoyancy"
                                                ]
                                            ],
                                            [
                                                "type" => "null"
                                            ]
                                        ]
                                    ],
                                    "textContent" => ["type" => ["string", "null"]],
                                    "textSize" => ["type" => ["number", "null"]],
                                    "textColor" => ["type" => ["string", "null"]],
                                    "layerEffectsEnabled" => ["type" => ["boolean", "null"]],
                                    "layerEffectSettings" => [
                                        "anyOf" => [
                                            [
                                                "type" => "object",
                                                "additionalProperties" => false,
                                                "properties" => [
                                                    "brightness" => ["type" => ["number", "null"]],
                                                    "contrast" => ["type" => ["number", "null"]],
                                                    "grayscale" => ["type" => ["number", "null"]],
                                                    "hueRotate" => ["type" => ["number", "null"]],
                                                    "invert" => ["type" => ["number", "null"]],
                                                    "opacity" => ["type" => ["number", "null"]],
                                                    "saturate" => ["type" => ["number", "null"]],
                                                    "sepia" => ["type" => ["number", "null"]],
                                                    "blur" => ["type" => ["number", "null"]],
                                                    "dropShadowColor" => ["type" => ["string", "null"]],
                                                    "dropShadowBlur" => ["type" => ["number", "null"]],
                                                    "dropShadowOffsetX" => ["type" => ["number", "null"]],
                                                    "dropShadowOffsetY" => ["type" => ["number", "null"]]
                                                ],
                                                "required" => [
                                                    "brightness",
                                                    "contrast",
                                                    "grayscale",
                                                    "hueRotate",
                                                    "invert",
                                                    "opacity",
                                                    "saturate",
                                                    "sepia",
                                                    "blur",
                                                    "dropShadowColor",
                                                    "dropShadowBlur",
                                                    "dropShadowOffsetX",
                                                    "dropShadowOffsetY"
                                                ]
                                            ],
                                            [
                                                "type" => "null"
                                            ]
                                        ]
                                    ],
                                    "layerBlendMode" => [
                                        "anyOf" => [
                                            [
                                                "type" => "string",
                                                "enum" => [
                                                    "normal",
                                                    "average",
                                                    "color-burn",
                                                    "color-dodge",
                                                    "color",
                                                    "darken",
                                                    "destination-atop",
                                                    "destination-in",
                                                    "destination-out",
                                                    "destination-over",
                                                    "difference",
                                                    "exclusion",
                                                    "hard-light",
                                                    "hue",
                                                    "invert",
                                                    "lighten",
                                                    "lighter",
                                                    "luminosity",
                                                    "multiply",
                                                    "overlay",
                                                    "saturation",
                                                    "screen",
                                                    "soft-light",
                                                    "source-atop",
                                                    "source-in",
                                                    "source-out",
                                                    "vivid-light",
                                                    "xor"
                                                ]
                                            ],
                                            [
                                                "type" => "null"
                                            ]
                                        ]
                                    ]
                                ],
                                "required" => [
                                    "id",
                                    "name",
                                    "type",
                                    "animations",
                                    "pointKeyframes",
                                    "pointStyle",
                                    "lineStyle",
                                    "polygonStyle",
                                    "particleStyle",
                                    "volumeStyle",
                                    "textContent",
                                    "textSize",
                                    "textColor",
                                    "layerEffectsEnabled",
                                    "layerEffectSettings",
                                    "layerBlendMode"
                                ]
                            ]
                        ]
                    ],
                    "required" => [
                        "version",
                        "savedAt",
                        "projectName",
                        "spatialReference",
                        "app",
                        "timeline",
                        "layers"
                    ]
                ]
            ],
            "required" => ["_pulse"]
        ]
    ],
    "required" => ["type", "features", "properties"]
];

$instructions = trim(
    "You generate Pulse animation project JSON. " .
    "Return ONLY valid JSON matching the ProjectSnapshot schema. " .
    "Use type='FeatureCollection' at the top and type='Feature' in features. " .
    "Set properties._pulse.version=1. " .
    "Use spatialReference wkid 4326 (WGS84). " .
    "Keep timeline durationOverride and animation durations at or below 60 seconds. " .
    "Default durationOverride to 6 seconds unless the user specifies otherwise. " .
    "Do not overlap animations on the same layer; avoid multiple animations running at the same time. " .
    "Valid animation types: " .
    "point=[fadeIn, fadeOut, pulse, bounce, spin, grow, followPath], " .
    "polyline=[draw, drawReverse, fadeIn, fadeOut], " .
    "polygon=[fadeIn, fadeOut, fill, pulse], " .
    "text=[fadeIn, fadeOut, typewriter, bounce], " .
    "feature=[field], " .
    "particles=[smoke, fire]. " .
    "Valid point styles: " .
    "[circle, square, diamond, triangle, cross, x, home, map-pin, star, hexagon, pentagon, octagon, heart, drop, shield, flag, " .
    "phosphor-map-pin, phosphor-map-pin-line, phosphor-map-pin-plus, phosphor-map-pin-simple, phosphor-map-pin-simple-line, " .
    "phosphor-map-trifold, phosphor-navigation-arrow, phosphor-compass, phosphor-compass-rose, phosphor-crosshair, " .
    "phosphor-crosshair-simple, phosphor-push-pin, phosphor-push-pin-simple, phosphor-push-pin-slash, " .
    "phosphor-push-pin-simple-slash, phosphor-path, phosphor-flag, phosphor-flag-banner, phosphor-flag-checkered, " .
    "phosphor-flag-pennant, phosphor-car, phosphor-car-simple, phosphor-taxi, phosphor-bus, phosphor-train, phosphor-tram, " .
    "phosphor-subway, phosphor-airplane, phosphor-airplane-landing, phosphor-airplane-takeoff, phosphor-bicycle, phosphor-motorcycle, " .
    "phosphor-scooter, phosphor-boat, phosphor-truck, phosphor-van, phosphor-cable-car, phosphor-anchor, phosphor-lifebuoy, " .
    "phosphor-lighthouse, phosphor-house, phosphor-house-simple, phosphor-building, phosphor-building-office, phosphor-buildings, " .
    "phosphor-hospital, phosphor-student, phosphor-graduation-cap, phosphor-police-car, phosphor-fire-truck, model-car, model-bus, " .
    "model-train, model-boat, model-airplane, phosphor-church, " .
    "phosphor-bank, phosphor-gas-pump, phosphor-charging-station, phosphor-plug-charging, phosphor-coffee, phosphor-bowl-food, " .
    "phosphor-fork-knife, phosphor-park, phosphor-tree, phosphor-mountains, phosphor-bridge, phosphor-tent, phosphor-bed, " .
    "phosphor-number-circle-zero, phosphor-number-circle-one, phosphor-number-circle-two, phosphor-number-circle-three, " .
    "phosphor-number-circle-four, phosphor-number-circle-five, phosphor-number-circle-six, phosphor-number-circle-seven, " .
    "phosphor-number-circle-eight, phosphor-number-circle-nine]. " .
    "Default to mode='2d' unless the user clearly asks for 3d or uses strong 3d cues such as flyover, orbit, terrain, buildings, skyline, or cinematic scene language. " .
    "Do not add camera movement, viewTrackKeyframes, pans, or zooms unless the user explicitly asks for them. " .
    "When the view is not explicitly directed, set a clean overview extent that shows all animated content. " .
    "For flights, airports, departures, arrivals, or air routes, prefer straight polyline legs rather than routed driving geometry. Flights work well with a dark basemap, light lines, airport labels, and followPath aircraft icons. " .
    "For driving, directions, road trips, or routed travel, prefer routed road polylines and add a followPath vehicle point layer when it improves clarity. Drives often look cleaner with basemap labels off. " .
    "Split multi-leg journeys into separate legs instead of merging them into one line. Sequence chained legs as a step-by-step journey; fan-out routes may animate together. " .
    "If the prompt is underspecified, add clean text labels for important places, especially origins and destinations. Fade labels in only after the related line draw finishes. " .
    "Use creativity when details are missing, but keep the result clean and showcase-ready. " .
    "If the user asks for top flights or random lines without listing destinations, choose plausible airports or random start/end points that fit the request and label them clearly. " .
    "Valid line styles: [solid, arrow-start, arrow-end, arrow-both, dash, dot, dash-dot, short-dash, short-dot, short-dash-dot, " .
    "short-dash-dot-dot, long-dash, long-dash-dot, tube-3d]. " .
    "Valid polygon fill styles: [solid, backward-diagonal, forward-diagonal, diagonal-cross, cross, horizontal, vertical, none]. " .
    "Valid polygon outline styles: [solid, dash, dot, dash-dot, short-dash, short-dot, short-dash-dot, short-dash-dot-dot, long-dash, long-dash-dot]. " .
    "Valid blend modes: [normal, average, color-burn, color-dodge, color, darken, destination-atop, destination-in, destination-out, destination-over, " .
    "difference, exclusion, hard-light, hue, invert, lighten, lighter, luminosity, multiply, overlay, saturation, screen, soft-light, source-atop, " .
    "source-in, source-out, vivid-light, xor]. Default blend mode is normal; if the user asks to desaturate, use blend mode color. " .
    "Layer effects: set layerEffectSettings and layerEffectsEnabled=true when asked for effects. " .
    "For drop shadows, set layerEffectSettings.dropShadowOffsetX, dropShadowOffsetY, dropShadowBlur, dropShadowColor (hex or rgba). " .
    "Other effects in layerEffectSettings: brightness, contrast, grayscale, hueRotate, invert, opacity, saturate, sepia, blur. " .
    "Provide properties._pulse.app with layout, customWidth/customHeight (null unless layout is 'custom'), " .
    "isRotated, basemap, basemapVisible, optional basemapLabelsVisible/backgroundColor/backgroundTransparent/google3DTilesEnabled, mode (2d or 3d), " .
    "optional camera for 3d (position x/y/z plus heading/tilt), optional viewTrackKeyframes, optional app.scene.cameraStudio " .
    "(fov, qualityProfile, atmosphereQuality, glowEnabled, glowIntensity, cinematicFxEnabled, exposure, contrast, saturation, letterbox, noiseLevel, scanlineLevel, vignetteLevel, jitter, chromaticAberration), optional app.scene.lighting, and optional extent. " .
    "Provide properties._pulse.timeline.durationOverride (number or null). " .
    "Provide properties._pulse.layers[] with id, name, type, animations, and any needed style fields. " .
    "Use type='particles' for smoke/fire particle emitters; avoid legacy type='volume'. " .
    "For particles layers, only use smoke or fire animations. " .
    "For particles layers, provide particleStyle with width, depth, height, floorOffset, opacity, slices, color, edgeColor, preset, emitterMode, emitterRadius, fireLifetime, smokeLifetime, fireSpeed, smokeSpeed, variation, turbulence, windX, windY, and buoyancy. " .
    "Copy particleStyle to volumeStyle for compatibility. " .
    "For point followPath animations, set pathLayerId to a matching polyline layer id and include orientToPath, reverse, and smoothFollow booleans. " .
    "When mode='3d' and the subject is transport, prefer model-car/model-bus/model-train/model-boat/model-airplane over flat phosphor icons. " .
    "Do a final pass before responding: ensure layer order is sensible, labels sit above lines, and no single layer contains overlapping animations. " .
    "For each feature, set properties._pulse.layerId to a matching layer id."
);

$requestBody = [
    "model" => $model,
    "input" => [
        ["role" => "system", "content" => $instructions],
        ["role" => "user", "content" => $prompt]
    ],
    "text" => [
        "format" => [
            "type" => "json_schema",
            "name" => "pulse_project_snapshot",
            "schema" => $schema,
            "strict" => true
        ]
    ],
    "max_output_tokens" => $openAiMaxOutputTokens,
    "store" => false
];

[$responseBody, $httpCode, $requestError, $requestAttempts] = post_openai_responses_request(
    $requestBody,
    $apiKey,
    $openAiConnectTimeoutSeconds,
    $openAiTimeoutSeconds,
    $openAiMaxAttempts,
    $openAiRetryDelayMs
);

if (!is_string($responseBody)) {
    $isTimeout = is_array($requestError) && (int) ($requestError["curl_errno"] ?? 0) === 28;
    http_response_code($isTimeout ? 504 : 502);
    echo json_encode([
        "error" => $isTimeout ? "Upstream request timed out" : "Upstream request failed",
        "details" => array_merge(
            [
                "attempts" => $requestAttempts,
                "timeout_seconds" => $openAiTimeoutSeconds,
                "connect_timeout_seconds" => $openAiConnectTimeoutSeconds
            ],
            is_array($requestError) ? $requestError : []
        )
    ]);
    exit;
}

$responseData = json_decode($responseBody, true);
if (!is_array($responseData)) {
    http_response_code(502);
    echo json_encode(["error" => "Invalid upstream response"]);
    exit;
}

if ($httpCode < 200 || $httpCode >= 300) {
    http_response_code($httpCode);
    echo json_encode([
        "error" => "Upstream error",
        "details" => [
            "attempts" => $requestAttempts,
            "response" => $responseData
        ]
    ]);
    exit;
}

function extract_output_text(array $data): ?string {
    if (isset($data["output_text"]) && is_string($data["output_text"]) && trim($data["output_text"]) !== "") {
        return $data["output_text"];
    }
    if (!isset($data["output"]) || !is_array($data["output"])) {
        return null;
    }
    $parts = [];
    foreach ($data["output"] as $item) {
        if (!is_array($item) || ($item["type"] ?? "") !== "message") {
            continue;
        }
        $content = $item["content"] ?? null;
        if (!is_array($content)) {
            continue;
        }
        foreach ($content as $part) {
            if (!is_array($part) || ($part["type"] ?? "") !== "output_text") {
                continue;
            }
            $text = $part["text"] ?? null;
            if (is_string($text) && $text !== "") {
                $parts[] = $text;
            }
        }
    }
    if (!$parts) {
        return null;
    }
    return implode("", $parts);
}

function extract_refusal_text(array $data): ?string {
    foreach (($data["output"] ?? []) as $item) {
        if (!is_array($item) || ($item["type"] ?? "") !== "message") {
            continue;
        }
        foreach (($item["content"] ?? []) as $part) {
            if (!is_array($part) || ($part["type"] ?? "") !== "refusal") {
                continue;
            }
            $refusal = $part["refusal"] ?? null;
            if (is_string($refusal) && trim($refusal) !== "") {
                return $refusal;
            }
        }
    }
    return null;
}

function sanitize_model_json_text(string $text): string {
    $text = preg_replace('/^\xEF\xBB\xBF/', '', $text) ?? $text;
    $text = trim($text);
    if (preg_match('/^```(?:json)?\s*(.*?)\s*```$/si', $text, $m) === 1) {
        $text = trim($m[1]);
    }
    return $text;
}

function excerpt(string $text, int $limit = 240): string {
    $text = preg_replace('/\s+/u', ' ', trim($text)) ?? trim($text);
    if (function_exists('mb_strlen') && function_exists('mb_substr')) {
        return mb_strlen($text) > $limit ? mb_substr($text, 0, $limit) . "..." : $text;
    }
    return strlen($text) > $limit ? substr($text, 0, $limit) . "..." : $text;
}

if (($responseData["status"] ?? null) === "incomplete") {
    http_response_code(502);
    echo json_encode([
        "error" => "Model response was incomplete",
        "details" => [
            "attempts" => $requestAttempts,
            "incomplete_details" => $responseData["incomplete_details"] ?? null
        ]
    ]);
    exit;
}

$refusalText = extract_refusal_text($responseData);
if ($refusalText !== null) {
    http_response_code(422);
    echo json_encode([
        "error" => "Model refused request",
        "details" => ["refusal" => $refusalText]
    ]);
    exit;
}

$jsonText = extract_output_text($responseData);
if (!$jsonText) {
    http_response_code(502);
    echo json_encode(["error" => "Missing model output"]);
    exit;
}

$jsonText = sanitize_model_json_text($jsonText);
$snapshot = json_decode($jsonText, true);
if (!is_array($snapshot)) {
    http_response_code(502);
    echo json_encode([
        "error" => "Model output was not valid JSON",
        "details" => [
            "json_error" => json_last_error_msg(),
            "attempts" => $requestAttempts,
            "output_excerpt" => excerpt($jsonText)
        ]
    ]);
    exit;
}

// Normalize a few core fields for safety.
$snapshot["properties"]["_pulse"]["version"] = 1;
$snapshot["properties"]["_pulse"]["savedAt"] = gmdate("c");
if (is_array($routeLineCoords) && isset($routeLineCoords[0]["coords"])) {
    // Apply routed geometry to separate polyline layers.
    $baseLayer = null;
    $existingPolylineLayerIds = [];
    foreach ($snapshot["properties"]["_pulse"]["layers"] as $layer) {
        if (($layer["type"] ?? null) === "polyline") {
            if (is_string($layer["id"] ?? null) && $layer["id"] !== "") {
                $existingPolylineLayerIds[] = $layer["id"];
            }
            if (!$baseLayer) {
                $baseLayer = $layer;
            }
        }
    }
    if (!$baseLayer) {
        $baseLayer = [
            "id" => "route",
            "name" => "Route",
            "type" => "polyline",
            "animations" => [],
            "pointKeyframes" => null,
            "pointStyle" => null,
            "lineStyle" => ["style" => "arrow-end", "width" => 3, "color" => "#cc1f1f"],
            "polygonStyle" => null,
            "textContent" => null,
            "textSize" => null,
            "textColor" => null,
            "layerBlendMode" => "normal"
        ];
    }

    // Remove existing features and polyline layers (we'll rebuild them).
    $snapshot["features"] = array_values(array_filter($snapshot["features"], function ($feature) {
        return ($feature["geometry"]["type"] ?? null) !== "LineString";
    }));
    $snapshot["properties"]["_pulse"]["layers"] = array_values(array_filter(
        $snapshot["properties"]["_pulse"]["layers"],
        fn($l) => ($l["type"] ?? null) !== "polyline"
    ));

    $duration = $snapshot["properties"]["_pulse"]["timeline"]["durationOverride"] ?? 6;
    $duration = clamp_duration($duration, 60) ?? 6;
    $routeChain = routes_form_chain($routeLineCoords);
    $routeStart = 0.0;
    $newRouteLayerIds = [];

    foreach ($routeLineCoords as $idx => $route) {
        $layerId = "route-" . ($idx + 1);
        $newRouteLayerIds[] = $layerId;
        $layerName = "Route " . ($idx + 1);
        if (!empty($route["from"]) && !empty($route["to"])) {
            $layerName = $route["from"] . " to " . $route["to"];
        }

        $layer = $baseLayer;
        $layer["id"] = $layerId;
        $layer["name"] = $layerName;
        $animStart = $routeChain ? $routeStart : 0;
        $layer["animations"] = [
            ["type" => "draw", "duration" => $duration, "start" => $animStart]
        ];
        if (is_array($layer["lineStyle"])) {
            $layer["lineStyle"]["style"] = "arrow-end";
        }
        $snapshot["properties"]["_pulse"]["layers"][] = $layer;

        $snapshot["features"][] = [
            "type" => "Feature",
            "geometry" => [
                "type" => "LineString",
                "coordinates" => $route["coords"]
            ],
            "properties" => [
                "_pulse" => ["layerId" => $layerId]
            ]
        ];
        if ($routeChain) {
            $routeStart += $duration;
        }
    }

    if ($newRouteLayerIds && isset($snapshot["properties"]["_pulse"]["layers"]) && is_array($snapshot["properties"]["_pulse"]["layers"])) {
        $replacementPathLayerId = $newRouteLayerIds[0];
        foreach ($snapshot["properties"]["_pulse"]["layers"] as &$layer) {
            if (($layer["type"] ?? null) !== "point" || !isset($layer["animations"]) || !is_array($layer["animations"])) {
                continue;
            }
            foreach ($layer["animations"] as &$anim) {
                if (($anim["type"] ?? null) !== "followPath") {
                    continue;
                }
                $pathLayerId = $anim["pathLayerId"] ?? null;
                $isMissingPathLayerId = !is_string($pathLayerId) || $pathLayerId === "";
                $referencesRemovedPolyline =
                    is_string($pathLayerId) &&
                    in_array($pathLayerId, $existingPolylineLayerIds, true) &&
                    !in_array($pathLayerId, $newRouteLayerIds, true);
                if ($isMissingPathLayerId || $referencesRemovedPolyline) {
                    $anim["pathLayerId"] = $replacementPathLayerId;
                }
            }
            unset($anim);
        }
        unset($layer);
    }

    // Set extent around all routes if none provided.
    $xs = [];
    $ys = [];
    foreach ($routeLineCoords as $route) {
        foreach ($route["coords"] as $p) {
            if (!is_array($p) || count($p) < 2) continue;
            $xs[] = $p[0];
            $ys[] = $p[1];
        }
    }
    if ($xs && $ys) {
        $extent = [
            "xmin" => min($xs),
            "ymin" => min($ys),
            "xmax" => max($xs),
            "ymax" => max($ys),
            "wkid" => 4326
        ];
        if (!isset($snapshot["properties"]["_pulse"]["app"]["extent"]) || $snapshot["properties"]["_pulse"]["app"]["extent"] === null) {
            $snapshot["properties"]["_pulse"]["app"]["extent"] = $extent;
        }
    }
}
// Force WGS84 for now.
$snapshot["properties"]["_pulse"]["spatialReference"] = ["wkid" => 4326];
if (isset($snapshot["properties"]["_pulse"]["app"]["extent"]) && is_array($snapshot["properties"]["_pulse"]["app"]["extent"])) {
    $snapshot["properties"]["_pulse"]["app"]["extent"]["wkid"] = 4326;
}

function clamp_duration($value, $max) {
    if ($value === null) return null;
    $num = is_numeric($value) ? (float) $value : null;
    if ($num === null) return null;
    if ($num < 0) $num = 0;
    return $num > $max ? $max : $num;
}

function prompt_matches(string $prompt, string $pattern): bool {
    return preg_match($pattern, $prompt) === 1;
}

function prompt_requests_route(string $prompt): bool {
    return prompt_matches($prompt, '/\b(route|routing|drive|driving|directions|road ?trip)\b/i');
}

function prompt_requests_drive(string $prompt): bool {
    return prompt_matches($prompt, '/\b(drive|driving|directions|road ?trip)\b/i');
}

function prompt_requests_flight(string $prompt): bool {
    return prompt_matches($prompt, '/\b(flight|flights|airport|airports|airline|airlines|departure|departures|arrival|arrivals|plane|planes|aircraft|air route|air routes|air traffic)\b/i');
}

function prompt_requests_3d(string $prompt): bool {
    return prompt_matches($prompt, '/\b(3d|three[- ]?d|flyover|orbit|terrain|buildings?|skyline|cityscape|globe|cinematic)\b/i');
}

function prompt_requests_camera_motion(string $prompt): bool {
    return prompt_matches($prompt, '/\b(camera|camera move(?:ment)?|view movement|pan|zoom|orbit|flyover|fly[- ]through|dolly|tracking shot|track shot|sweep|tilt|rotate(?:\s+the)?\s+view)\b/i');
}

function prompt_requests_custom_view(string $prompt): bool {
    return prompt_requests_camera_motion($prompt)
        || prompt_matches($prompt, '/\b(extent|bounds|frame|framing|focus|close[- ]?up|overview|fit(?:ted)?(?:\s+\w+){0,2}\s+to)\b/i');
}

function routes_form_chain(array $routes): bool {
    if (count($routes) < 2) {
        return false;
    }
    for ($i = 1; $i < count($routes); $i++) {
        $prevTo = strtolower(trim((string) ($routes[$i - 1]["to"] ?? "")));
        $currFrom = strtolower(trim((string) ($routes[$i]["from"] ?? "")));
        if ($prevTo === "" || $currFrom === "" || $prevTo !== $currFrom) {
            return false;
        }
    }
    return true;
}

function is_coordinate_pair($value): bool {
    return is_array($value)
        && count($value) >= 2
        && is_numeric($value[0] ?? null)
        && is_numeric($value[1] ?? null);
}

function collect_xy_pairs($coords, array &$xs, array &$ys): void {
    if (!is_array($coords)) {
        return;
    }
    if (is_coordinate_pair($coords)) {
        $xs[] = (float) $coords[0];
        $ys[] = (float) $coords[1];
        return;
    }
    foreach ($coords as $item) {
        collect_xy_pairs($item, $xs, $ys);
    }
}

function build_padded_extent(array $xs, array $ys): ?array {
    if (!$xs || !$ys) {
        return null;
    }
    $xmin = min($xs);
    $ymin = min($ys);
    $xmax = max($xs);
    $ymax = max($ys);
    $width = max(0.01, $xmax - $xmin);
    $height = max(0.01, $ymax - $ymin);
    $padX = max($width * 0.12, 0.1);
    $padY = max($height * 0.12, 0.1);
    return [
        "xmin" => $xmin - $padX,
        "ymin" => $ymin - $padY,
        "xmax" => $xmax + $padX,
        "ymax" => $ymax + $padY,
        "wkid" => 4326
    ];
}

function compute_snapshot_extent(array $snapshot): ?array {
    $xs = [];
    $ys = [];
    foreach (($snapshot["features"] ?? []) as $feature) {
        if (!is_array($feature)) {
            continue;
        }
        collect_xy_pairs($feature["geometry"]["coordinates"] ?? null, $xs, $ys);
    }
    foreach (($snapshot["properties"]["_pulse"]["layers"] ?? []) as $layer) {
        if (!is_array($layer) || !isset($layer["pointKeyframes"]) || !is_array($layer["pointKeyframes"])) {
            continue;
        }
        foreach ($layer["pointKeyframes"] as $keyframe) {
            if (!is_array($keyframe)) {
                continue;
            }
            if (is_numeric($keyframe["x"] ?? null) && is_numeric($keyframe["y"] ?? null)) {
                $xs[] = (float) $keyframe["x"];
                $ys[] = (float) $keyframe["y"];
            }
        }
    }
    return build_padded_extent($xs, $ys);
}

function normalize_whitespace(string $value): string {
    $value = preg_replace('/\s+/u', ' ', trim($value));
    return is_string($value) ? $value : trim($value ?? "");
}

function slugify_layer_token(string $value): string {
    $value = normalize_whitespace(strtolower($value));
    $value = preg_replace('/[^a-z0-9]+/i', '-', $value);
    $value = is_string($value) ? trim($value, '-') : "";
    return $value !== "" ? $value : "layer";
}

function next_unique_layer_id(array &$existingIds, string $base): string {
    $root = slugify_layer_token($base);
    $candidate = $root;
    $counter = 2;
    while (isset($existingIds[$candidate])) {
        $candidate = $root . "-" . $counter;
        $counter++;
    }
    $existingIds[$candidate] = true;
    return $candidate;
}

function get_line_endpoints(array $coords): ?array {
    if (!isset($coords[0]) || !isset($coords[array_key_last($coords)])) {
        return null;
    }
    $start = $coords[0];
    $end = $coords[array_key_last($coords)];
    if (!is_coordinate_pair($start) || !is_coordinate_pair($end)) {
        return null;
    }
    return [
        [(float) $start[0], (float) $start[1]],
        [(float) $end[0], (float) $end[1]]
    ];
}

function parse_route_labels_from_name(string $name): ?array {
    $name = normalize_whitespace($name);
    if (!preg_match('/^(.+?)\s+(?:to|->|→)\s+(.+)$/iu', $name, $m)) {
        return null;
    }
    $from = normalize_whitespace($m[1]);
    $to = normalize_whitespace($m[2]);
    if ($from === "" || $to === "") {
        return null;
    }
    return [$from, $to];
}

function layer_animation_window(array $layer, array $preferredTypes = []): array {
    $bestStart = null;
    $bestEnd = null;
    $fallbackStart = 0.0;
    $fallbackEnd = 0.0;
    foreach (($layer["animations"] ?? []) as $anim) {
        if (!is_array($anim)) {
            continue;
        }
        $start = is_numeric($anim["start"] ?? null) ? (float) $anim["start"] : 0.0;
        $duration = is_numeric($anim["duration"] ?? null) ? (float) $anim["duration"] : 0.0;
        $end = $start + $duration;
        $fallbackStart = min($fallbackStart, $start);
        $fallbackEnd = max($fallbackEnd, $end);
        $type = (string) ($anim["type"] ?? "");
        if ($preferredTypes && !in_array($type, $preferredTypes, true)) {
            continue;
        }
        $bestStart = $bestStart === null ? $start : min($bestStart, $start);
        $bestEnd = $bestEnd === null ? $end : max($bestEnd, $end);
    }
    if ($bestStart !== null && $bestEnd !== null) {
        return [$bestStart, $bestEnd];
    }
    return [$fallbackStart, $fallbackEnd];
}

function make_text_label_snapshot(string $layerId, string $layerName, string $text, array $coord, float $start): array {
    return [
        "layer" => [
            "id" => $layerId,
            "name" => $layerName,
            "type" => "text",
            "animations" => [
                ["type" => "fadeIn", "start" => round($start, 2), "duration" => 0.8]
            ],
            "pointKeyframes" => null,
            "pointStyle" => null,
            "lineStyle" => null,
            "polygonStyle" => null,
            "particleStyle" => null,
            "volumeStyle" => null,
            "textContent" => $text,
            "textSize" => 14,
            "textColor" => "#22323a",
            "layerEffectsEnabled" => false,
            "layerEffectSettings" => null,
            "layerBlendMode" => "normal"
        ],
        "feature" => [
            "type" => "Feature",
            "geometry" => [
                "type" => "Point",
                "coordinates" => [$coord[0], $coord[1]]
            ],
            "properties" => [
                "_pulse" => ["layerId" => $layerId]
            ]
        ]
    ];
}

function ensure_showcase_labels(array $snapshot): array {
    $layers = $snapshot["properties"]["_pulse"]["layers"] ?? null;
    $features = $snapshot["features"] ?? null;
    if (!is_array($layers) || !is_array($features)) {
        return $snapshot;
    }

    $existingLayerIds = [];
    $existingTexts = [];
    $featuresByLayer = [];
    foreach ($layers as $layer) {
        if (!is_array($layer)) {
            continue;
        }
        if (is_string($layer["id"] ?? null) && $layer["id"] !== "") {
            $existingLayerIds[$layer["id"]] = true;
        }
        if (($layer["type"] ?? null) === "text" && is_string($layer["textContent"] ?? null)) {
            $existingTexts[strtolower(normalize_whitespace($layer["textContent"]))] = true;
        }
    }
    foreach ($features as $feature) {
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (is_string($layerId) && !isset($featuresByLayer[$layerId])) {
            $featuresByLayer[$layerId] = $feature;
        }
    }

    foreach ($layers as $layer) {
        if (!is_array($layer) || ($layer["type"] ?? null) !== "polyline") {
            continue;
        }
        $layerId = $layer["id"] ?? null;
        $name = $layer["name"] ?? null;
        if (!is_string($layerId) || !is_string($name)) {
            continue;
        }
        $labels = parse_route_labels_from_name($name);
        $feature = $featuresByLayer[$layerId] ?? null;
        $coords = $feature["geometry"]["coordinates"] ?? null;
        if (!$labels || !is_array($coords)) {
            continue;
        }
        $endpoints = get_line_endpoints($coords);
        if (!$endpoints) {
            continue;
        }
        [, $lineEnd] = layer_animation_window($layer, ["draw", "drawReverse"]);
        $labelStart = $lineEnd + 0.1;
        foreach ([[$labels[0], $endpoints[0]], [$labels[1], $endpoints[1]]] as [$text, $coord]) {
            $key = strtolower(normalize_whitespace($text));
            if ($key === "" || isset($existingTexts[$key])) {
                continue;
            }
            $newId = next_unique_layer_id($existingLayerIds, $layerId . "-label-" . $text);
            $labelSnapshot = make_text_label_snapshot($newId, $text . " Label", $text, $coord, $labelStart);
            $snapshot["properties"]["_pulse"]["layers"][] = $labelSnapshot["layer"];
            $snapshot["features"][] = $labelSnapshot["feature"];
            $existingTexts[$key] = true;
        }
    }

    return $snapshot;
}

function ensure_drive_follow_path_layers(array $snapshot, string $prompt): array {
    if (!prompt_requests_drive($prompt)) {
        return $snapshot;
    }
    $layers = $snapshot["properties"]["_pulse"]["layers"] ?? null;
    $features = $snapshot["features"] ?? null;
    if (!is_array($layers) || !is_array($features)) {
        return $snapshot;
    }

    $mode = $snapshot["properties"]["_pulse"]["app"]["mode"] ?? null;
    $pointStyle = $mode === "3d" ? "model-car" : "phosphor-car";
    $existingLayerIds = [];
    $featuresByLayer = [];
    $followPathLayerIds = [];
    foreach ($layers as $layer) {
        if (!is_array($layer)) {
            continue;
        }
        $layerId = $layer["id"] ?? null;
        if (is_string($layerId) && $layerId !== "") {
            $existingLayerIds[$layerId] = true;
        }
        foreach (($layer["animations"] ?? []) as $anim) {
            if (!is_array($anim) || ($anim["type"] ?? null) !== "followPath") {
                continue;
            }
            $pathLayerId = $anim["pathLayerId"] ?? null;
            if (is_string($pathLayerId) && $pathLayerId !== "") {
                $followPathLayerIds[$pathLayerId] = true;
            }
        }
    }
    foreach ($features as $feature) {
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (is_string($layerId) && !isset($featuresByLayer[$layerId])) {
            $featuresByLayer[$layerId] = $feature;
        }
    }

    foreach ($layers as $layer) {
        if (!is_array($layer) || ($layer["type"] ?? null) !== "polyline") {
            continue;
        }
        $layerId = $layer["id"] ?? null;
        if (!is_string($layerId) || $layerId === "" || isset($followPathLayerIds[$layerId])) {
            continue;
        }
        $feature = $featuresByLayer[$layerId] ?? null;
        $coords = $feature["geometry"]["coordinates"] ?? null;
        if (!is_array($coords)) {
            continue;
        }
        $endpoints = get_line_endpoints($coords);
        if (!$endpoints) {
            continue;
        }
        [$animStart, $animEnd] = layer_animation_window($layer, ["draw", "drawReverse"]);
        $duration = max(0.5, $animEnd - $animStart);
        $lineColor = is_array($layer["lineStyle"] ?? null) ? ($layer["lineStyle"]["color"] ?? "#0a4c66") : "#0a4c66";
        $newId = next_unique_layer_id($existingLayerIds, $layerId . "-vehicle");
        $snapshot["properties"]["_pulse"]["layers"][] = [
            "id" => $newId,
            "name" => (($layer["name"] ?? $layerId) . " Vehicle"),
            "type" => "point",
            "animations" => [
                [
                    "type" => "followPath",
                    "start" => round($animStart, 2),
                    "duration" => round($duration, 2),
                    "pathLayerId" => $layerId,
                    "orientToPath" => true,
                    "reverse" => false,
                    "smoothFollow" => true
                ]
            ],
            "pointKeyframes" => null,
            "pointStyle" => [
                "style" => $pointStyle,
                "size" => 18,
                "color" => $lineColor,
                "outlineColor" => "#ffffff",
                "outlineWidth" => 1.5,
                "angle" => 0,
                "xoffset" => 0,
                "yoffset" => 0
            ],
            "lineStyle" => null,
            "polygonStyle" => null,
            "particleStyle" => null,
            "volumeStyle" => null,
            "textContent" => null,
            "textSize" => null,
            "textColor" => null,
            "layerEffectsEnabled" => false,
            "layerEffectSettings" => null,
            "layerBlendMode" => "normal"
        ];
        $snapshot["features"][] = [
            "type" => "Feature",
            "geometry" => [
                "type" => "Point",
                "coordinates" => $endpoints[0]
            ],
            "properties" => [
                "_pulse" => ["layerId" => $newId]
            ]
        ];
        $followPathLayerIds[$layerId] = true;
    }

    return $snapshot;
}

function normalize_transport_point_styles_for_mode(array $snapshot): array {
    $mode = $snapshot["properties"]["_pulse"]["app"]["mode"] ?? null;
    $to3d = [
        "phosphor-car" => "model-car",
        "phosphor-car-simple" => "model-car",
        "phosphor-taxi" => "model-car",
        "phosphor-truck" => "model-car",
        "phosphor-van" => "model-car",
        "phosphor-police-car" => "model-car",
        "phosphor-fire-truck" => "model-car",
        "phosphor-bus" => "model-bus",
        "phosphor-train" => "model-train",
        "phosphor-tram" => "model-train",
        "phosphor-subway" => "model-train",
        "phosphor-boat" => "model-boat",
        "phosphor-airplane" => "model-airplane",
        "phosphor-airplane-landing" => "model-airplane",
        "phosphor-airplane-takeoff" => "model-airplane"
    ];
    $to2d = [
        "model-car" => "phosphor-car",
        "model-bus" => "phosphor-bus",
        "model-train" => "phosphor-train",
        "model-boat" => "phosphor-boat",
        "model-airplane" => "phosphor-airplane"
    ];
    if (!isset($snapshot["properties"]["_pulse"]["layers"]) || !is_array($snapshot["properties"]["_pulse"]["layers"])) {
        return $snapshot;
    }
    foreach ($snapshot["properties"]["_pulse"]["layers"] as &$layer) {
        if (!is_array($layer) || ($layer["type"] ?? null) !== "point" || !is_array($layer["pointStyle"] ?? null)) {
            continue;
        }
        $style = $layer["pointStyle"]["style"] ?? null;
        if (!is_string($style) || $style === "") {
            continue;
        }
        if ($mode === "3d" && isset($to3d[$style])) {
            $layer["pointStyle"]["style"] = $to3d[$style];
        } elseif ($mode !== "3d" && isset($to2d[$style])) {
            $layer["pointStyle"]["style"] = $to2d[$style];
        }
    }
    unset($layer);
    return $snapshot;
}

function apply_showcase_app_defaults(array $snapshot, string $prompt): array {
    if (!isset($snapshot["properties"]["_pulse"]["app"]) || !is_array($snapshot["properties"]["_pulse"]["app"])) {
        return $snapshot;
    }
    $wants3d = prompt_requests_3d($prompt);
    $wantsCameraMotion = prompt_requests_camera_motion($prompt);
    $wantsCustomView = prompt_requests_custom_view($prompt);
    $app =& $snapshot["properties"]["_pulse"]["app"];

    $app["mode"] = $wants3d ? "3d" : "2d";
    if (!$wants3d) {
        $app["scene"] = null;
        $app["camera"] = null;
    }
    if (!$wantsCameraMotion) {
        $app["viewTrackKeyframes"] = null;
    }
    if (!$wantsCustomView) {
        $computedExtent = compute_snapshot_extent($snapshot);
        if ($computedExtent !== null) {
            $app["extent"] = $computedExtent;
        }
    } elseif (isset($app["extent"]) && is_array($app["extent"])) {
        $app["extent"]["wkid"] = 4326;
    }
    return $snapshot;
}

function sort_snapshot_layers(array $snapshot): array {
    $layers = $snapshot["properties"]["_pulse"]["layers"] ?? null;
    $features = $snapshot["features"] ?? null;
    if (!is_array($layers) || !is_array($features)) {
        return $snapshot;
    }

    $indexedLayers = [];
    foreach ($layers as $index => $layer) {
        $type = $layer["type"] ?? "";
        $weight = match ($type) {
            "polygon" => 10,
            "feature" => 15,
            "polyline" => 20,
            "point" => 30,
            "particles", "volume" => 35,
            "text" => 40,
            default => 50,
        };
        if ($type === "point") {
            foreach (($layer["animations"] ?? []) as $anim) {
                if (is_array($anim) && ($anim["type"] ?? null) === "followPath") {
                    $weight = 32;
                    break;
                }
            }
        }
        $indexedLayers[] = ["index" => $index, "weight" => $weight, "layer" => $layer];
    }
    usort($indexedLayers, function ($a, $b) {
        if ($a["weight"] !== $b["weight"]) {
            return $a["weight"] <=> $b["weight"];
        }
        return $a["index"] <=> $b["index"];
    });

    $sortedLayers = array_map(fn($entry) => $entry["layer"], $indexedLayers);
    $layerOrder = [];
    foreach ($sortedLayers as $index => $layer) {
        if (is_string($layer["id"] ?? null)) {
            $layerOrder[$layer["id"]] = $index;
        }
    }
    usort($features, function ($a, $b) use ($layerOrder) {
        $aId = $a["properties"]["_pulse"]["layerId"] ?? "";
        $bId = $b["properties"]["_pulse"]["layerId"] ?? "";
        return ($layerOrder[$aId] ?? 9999) <=> ($layerOrder[$bId] ?? 9999);
    });

    $snapshot["properties"]["_pulse"]["layers"] = $sortedLayers;
    $snapshot["features"] = $features;
    return $snapshot;
}

function base_layer_id(string $layerId): string {
    return preg_replace('/-(feat|seg)-\d+$/', '', $layerId) ?? $layerId;
}

function geometry_candidate_layer_types(?string $geometryType): array {
    return match ($geometryType) {
        "Point", "MultiPoint" => ["point", "text", "particles", "volume"],
        "LineString", "MultiLineString" => ["polyline"],
        "Polygon", "MultiPolygon" => ["polygon"],
        default => []
    };
}

function choose_repair_layer_id(
    ?string $originalLayerId,
    array $candidateTypes,
    array $layersById,
    array $splitLayerIdsByBase,
    array &$splitCandidateCursor
): ?string {
    $preferredIds = [];
    if (is_string($originalLayerId) && $originalLayerId !== "") {
        $baseId = base_layer_id($originalLayerId);
        foreach ([$originalLayerId, $baseId] as $idKey) {
            if (isset($layersById[$idKey])) {
                $preferredIds[] = $idKey;
            }
            foreach (($splitLayerIdsByBase[$idKey] ?? []) as $splitId) {
                $preferredIds[] = $splitId;
            }
        }
        foreach (array_keys($layersById) as $layerId) {
            if (str_starts_with($layerId, $originalLayerId . "-") || str_starts_with($layerId, $baseId . "-")) {
                $preferredIds[] = $layerId;
            }
        }
    }

    $seen = [];
    $orderedCandidates = [];
    foreach ($preferredIds as $candidateId) {
        if (!isset($layersById[$candidateId]) || isset($seen[$candidateId])) {
            continue;
        }
        $orderedCandidates[] = $candidateId;
        $seen[$candidateId] = true;
    }
    if (!$orderedCandidates && count($candidateTypes) === 1) {
        $matches = [];
        foreach ($layersById as $candidateId => $layer) {
            if (in_array($layer["type"] ?? null, $candidateTypes, true)) {
                $matches[] = $candidateId;
            }
        }
        if (count($matches) === 1) {
            return $matches[0];
        }
        $orderedCandidates = $matches;
    }

    foreach ($orderedCandidates as $candidateId) {
        $layerType = $layersById[$candidateId]["type"] ?? null;
        if ($candidateTypes && !in_array($layerType, $candidateTypes, true)) {
            continue;
        }
        $baseId = base_layer_id($candidateId);
        $cursorKey = $baseId . "|" . $layerType;
        $splitIds = array_values(array_filter(
            $splitLayerIdsByBase[$baseId] ?? [],
            fn($id) => ($layersById[$id]["type"] ?? null) === $layerType
        ));
        if ($splitIds) {
            $cursor = $splitCandidateCursor[$cursorKey] ?? 0;
            $chosen = $splitIds[$cursor % count($splitIds)];
            $splitCandidateCursor[$cursorKey] = $cursor + 1;
            return $chosen;
        }
        return $candidateId;
    }

    return null;
}

function repair_feature_layer_links(array $snapshot): array {
    $layers = $snapshot["properties"]["_pulse"]["layers"] ?? null;
    $features = $snapshot["features"] ?? null;
    if (!is_array($layers) || !is_array($features)) {
        return $snapshot;
    }

    $layersById = [];
    $splitLayerIdsByBase = [];
    foreach ($layers as $layer) {
        if (!is_array($layer)) {
            continue;
        }
        $layerId = $layer["id"] ?? null;
        if (!is_string($layerId) || $layerId === "") {
            continue;
        }
        $layersById[$layerId] = $layer;
        $baseId = base_layer_id($layerId);
        if ($baseId !== $layerId) {
            $splitLayerIdsByBase[$baseId][] = $layerId;
        }
    }

    $splitCandidateCursor = [];
    $repairedFeatures = [];
    foreach ($features as $feature) {
        if (!is_array($feature)) {
            continue;
        }
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (is_string($layerId) && isset($layersById[$layerId])) {
            $repairedFeatures[] = $feature;
            continue;
        }

        $geometryType = $feature["geometry"]["type"] ?? null;
        $candidateTypes = geometry_candidate_layer_types(is_string($geometryType) ? $geometryType : null);
        $replacementLayerId = choose_repair_layer_id(
            is_string($layerId) ? $layerId : null,
            $candidateTypes,
            $layersById,
            $splitLayerIdsByBase,
            $splitCandidateCursor
        );
        if (!is_string($replacementLayerId) || !isset($layersById[$replacementLayerId])) {
            continue;
        }
        $feature["properties"]["_pulse"]["layerId"] = $replacementLayerId;
        $repairedFeatures[] = $feature;
    }

    $snapshot["features"] = array_values($repairedFeatures);
    return $snapshot;
}

function parse_route_labels_from_name_v2(string $name): ?array {
    $name = normalize_whitespace($name);
    if (!preg_match('/^(.+?)\s+(?:to|->)\s+(.+)$/i', $name, $m)) {
        return null;
    }
    $from = normalize_whitespace($m[1]);
    $to = normalize_whitespace($m[2]);
    if ($from === "" || $to === "") {
        return null;
    }
    return [$from, $to];
}

function layer_animation_window_v2(array $layer, array $preferredTypes = []): array {
    $bestStart = null;
    $bestEnd = null;
    $fallbackStart = null;
    $fallbackEnd = null;
    foreach (($layer["animations"] ?? []) as $anim) {
        if (!is_array($anim)) {
            continue;
        }
        $start = is_numeric($anim["start"] ?? null) ? (float) $anim["start"] : 0.0;
        $duration = is_numeric($anim["duration"] ?? null) ? (float) $anim["duration"] : 0.0;
        $end = $start + $duration;
        $fallbackStart = $fallbackStart === null ? $start : min($fallbackStart, $start);
        $fallbackEnd = $fallbackEnd === null ? $end : max($fallbackEnd, $end);
        $type = (string) ($anim["type"] ?? "");
        if ($preferredTypes && !in_array($type, $preferredTypes, true)) {
            continue;
        }
        $bestStart = $bestStart === null ? $start : min($bestStart, $start);
        $bestEnd = $bestEnd === null ? $end : max($bestEnd, $end);
    }
    if ($bestStart !== null && $bestEnd !== null) {
        return [$bestStart, $bestEnd];
    }
    return [$fallbackStart ?? 0.0, $fallbackEnd ?? 0.0];
}

function make_text_label_snapshot_v2(string $layerId, string $layerName, string $text, array $coord, float $start, string $textColor): array {
    return [
        "layer" => [
            "id" => $layerId,
            "name" => $layerName,
            "type" => "text",
            "animations" => [
                ["type" => "fadeIn", "start" => round($start, 2), "duration" => 0.8]
            ],
            "pointKeyframes" => null,
            "pointStyle" => null,
            "lineStyle" => null,
            "polygonStyle" => null,
            "particleStyle" => null,
            "volumeStyle" => null,
            "textContent" => $text,
            "textSize" => 14,
            "textColor" => $textColor,
            "layerEffectsEnabled" => false,
            "layerEffectSettings" => null,
            "layerBlendMode" => "normal"
        ],
        "feature" => [
            "type" => "Feature",
            "geometry" => [
                "type" => "Point",
                "coordinates" => [$coord[0], $coord[1]]
            ],
            "properties" => [
                "_pulse" => ["layerId" => $layerId]
            ]
        ]
    ];
}

function ensure_showcase_labels_v2(array $snapshot, string $prompt): array {
    $layers = $snapshot["properties"]["_pulse"]["layers"] ?? null;
    $features = $snapshot["features"] ?? null;
    if (!is_array($layers) || !is_array($features)) {
        return $snapshot;
    }

    $existingLayerIds = [];
    $existingTexts = [];
    $featuresByLayer = [];
    $labelColor = prompt_requests_flight($prompt) ? "#f4f8ff" : "#22323a";

    foreach ($layers as $layer) {
        if (!is_array($layer)) {
            continue;
        }
        if (is_string($layer["id"] ?? null) && $layer["id"] !== "") {
            $existingLayerIds[$layer["id"]] = true;
        }
        if (($layer["type"] ?? null) === "text" && is_string($layer["textContent"] ?? null)) {
            $existingTexts[strtolower(normalize_whitespace($layer["textContent"]))] = true;
        }
    }
    foreach ($features as $feature) {
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (is_string($layerId) && !isset($featuresByLayer[$layerId])) {
            $featuresByLayer[$layerId] = $feature;
        }
    }

    foreach ($layers as $layer) {
        if (!is_array($layer) || ($layer["type"] ?? null) !== "polyline") {
            continue;
        }
        $layerId = $layer["id"] ?? null;
        $name = $layer["name"] ?? null;
        if (!is_string($layerId) || !is_string($name)) {
            continue;
        }
        $labels = parse_route_labels_from_name_v2($name);
        $feature = $featuresByLayer[$layerId] ?? null;
        $coords = $feature["geometry"]["coordinates"] ?? null;
        if (!$labels || !is_array($coords)) {
            continue;
        }
        $endpoints = get_line_endpoints($coords);
        if (!$endpoints) {
            continue;
        }
        [$lineStart, $lineEnd] = layer_animation_window_v2($layer, ["draw", "drawReverse"]);
        $labelSpecs = [
            [$labels[0], $endpoints[0], $lineStart],
            [$labels[1], $endpoints[1], $lineEnd + 0.1]
        ];
        foreach ($labelSpecs as [$text, $coord, $labelStart]) {
            $key = strtolower(normalize_whitespace($text));
            if ($key === "" || isset($existingTexts[$key])) {
                continue;
            }
            $newId = next_unique_layer_id($existingLayerIds, $layerId . "-label-" . $text);
            $labelSnapshot = make_text_label_snapshot_v2($newId, $text . " Label", $text, $coord, $labelStart, $labelColor);
            $snapshot["properties"]["_pulse"]["layers"][] = $labelSnapshot["layer"];
            $snapshot["features"][] = $labelSnapshot["feature"];
            $existingTexts[$key] = true;
        }
    }

    return $snapshot;
}

function ensure_transport_follow_path_layers_v2(array $snapshot, string $prompt): array {
    $isDrive = prompt_requests_drive($prompt);
    $isFlight = prompt_requests_flight($prompt);
    if (!$isDrive && !$isFlight) {
        return $snapshot;
    }
    $layers = $snapshot["properties"]["_pulse"]["layers"] ?? null;
    $features = $snapshot["features"] ?? null;
    if (!is_array($layers) || !is_array($features)) {
        return $snapshot;
    }

    $mode = $snapshot["properties"]["_pulse"]["app"]["mode"] ?? null;
    $pointStyle = $isDrive
        ? ($mode === "3d" ? "model-car" : "phosphor-car")
        : ($mode === "3d" ? "model-airplane" : "phosphor-airplane");
    $layerSuffix = $isDrive ? "Vehicle" : "Aircraft";
    $existingLayerIds = [];
    $featuresByLayer = [];
    $followPathLayerIds = [];

    foreach ($layers as $layer) {
        if (!is_array($layer)) {
            continue;
        }
        $layerId = $layer["id"] ?? null;
        if (is_string($layerId) && $layerId !== "") {
            $existingLayerIds[$layerId] = true;
        }
        foreach (($layer["animations"] ?? []) as $anim) {
            if (!is_array($anim) || ($anim["type"] ?? null) !== "followPath") {
                continue;
            }
            $pathLayerId = $anim["pathLayerId"] ?? null;
            if (is_string($pathLayerId) && $pathLayerId !== "") {
                $followPathLayerIds[$pathLayerId] = true;
            }
        }
    }
    foreach ($features as $feature) {
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (is_string($layerId) && !isset($featuresByLayer[$layerId])) {
            $featuresByLayer[$layerId] = $feature;
        }
    }

    foreach ($layers as $layer) {
        if (!is_array($layer) || ($layer["type"] ?? null) !== "polyline") {
            continue;
        }
        $layerId = $layer["id"] ?? null;
        if (!is_string($layerId) || $layerId === "" || isset($followPathLayerIds[$layerId])) {
            continue;
        }
        $feature = $featuresByLayer[$layerId] ?? null;
        $coords = $feature["geometry"]["coordinates"] ?? null;
        if (!is_array($coords)) {
            continue;
        }
        $endpoints = get_line_endpoints($coords);
        if (!$endpoints) {
            continue;
        }
        [$animStart, $animEnd] = layer_animation_window_v2($layer, ["draw", "drawReverse"]);
        $duration = max(0.5, $animEnd - $animStart);
        $lineColor = is_array($layer["lineStyle"] ?? null) ? ($layer["lineStyle"]["color"] ?? "#0a4c66") : "#0a4c66";
        $newId = next_unique_layer_id($existingLayerIds, $layerId . "-" . strtolower($layerSuffix));
        $snapshot["properties"]["_pulse"]["layers"][] = [
            "id" => $newId,
            "name" => (($layer["name"] ?? $layerId) . " " . $layerSuffix),
            "type" => "point",
            "animations" => [
                [
                    "type" => "followPath",
                    "start" => round($animStart, 2),
                    "duration" => round($duration, 2),
                    "pathLayerId" => $layerId,
                    "orientToPath" => true,
                    "reverse" => false,
                    "smoothFollow" => true
                ]
            ],
            "pointKeyframes" => null,
            "pointStyle" => [
                "style" => $pointStyle,
                "size" => 18,
                "color" => $lineColor,
                "outlineColor" => "#ffffff",
                "outlineWidth" => 1.5,
                "angle" => 0,
                "xoffset" => 0,
                "yoffset" => 0
            ],
            "lineStyle" => null,
            "polygonStyle" => null,
            "particleStyle" => null,
            "volumeStyle" => null,
            "textContent" => null,
            "textSize" => null,
            "textColor" => null,
            "layerEffectsEnabled" => false,
            "layerEffectSettings" => null,
            "layerBlendMode" => "normal"
        ];
        $snapshot["features"][] = [
            "type" => "Feature",
            "geometry" => [
                "type" => "Point",
                "coordinates" => $endpoints[0]
            ],
            "properties" => [
                "_pulse" => ["layerId" => $newId]
            ]
        ];
        $followPathLayerIds[$layerId] = true;
    }

    return $snapshot;
}

function apply_intent_visual_defaults_v2(array $snapshot, string $prompt): array {
    $isFlight = prompt_requests_flight($prompt);
    $isDrive = prompt_requests_drive($prompt);
    $wantsArrowLines = $isFlight || $isDrive || prompt_matches($prompt, '/\brandom lines?\b/i');

    if (isset($snapshot["properties"]["_pulse"]["app"]) && is_array($snapshot["properties"]["_pulse"]["app"])) {
        if ($isFlight) {
            $snapshot["properties"]["_pulse"]["app"]["basemap"] = "dark-gray-vector";
            $snapshot["properties"]["_pulse"]["app"]["basemapVisible"] = true;
            $snapshot["properties"]["_pulse"]["app"]["basemapLabelsVisible"] = false;
            $snapshot["properties"]["_pulse"]["app"]["backgroundColor"] = "#06141f";
            $snapshot["properties"]["_pulse"]["app"]["backgroundTransparent"] = false;
        } elseif ($isDrive) {
            $snapshot["properties"]["_pulse"]["app"]["basemapLabelsVisible"] = false;
        }
    }

    if (!isset($snapshot["properties"]["_pulse"]["layers"]) || !is_array($snapshot["properties"]["_pulse"]["layers"])) {
        return $snapshot;
    }
    foreach ($snapshot["properties"]["_pulse"]["layers"] as &$layer) {
        if (!is_array($layer)) {
            continue;
        }
        if ($isFlight && ($layer["type"] ?? null) === "text") {
            $layer["textColor"] = "#f4f8ff";
        }
        if (($layer["type"] ?? null) !== "polyline") {
            continue;
        }
        $lineStyle = is_array($layer["lineStyle"] ?? null) ? $layer["lineStyle"] : [];
        $style = $lineStyle["style"] ?? null;
        if ($wantsArrowLines && (!is_string($style) || $style === "" || $style === "solid")) {
            $lineStyle["style"] = "arrow-end";
        }
        if ($isFlight) {
            $lineStyle["color"] = "#8fd8ff";
            if (!is_numeric($lineStyle["width"] ?? null) || (float) $lineStyle["width"] < 2.5) {
                $lineStyle["width"] = 2.5;
            }
            if (($layer["layerBlendMode"] ?? "normal") === "normal") {
                $layer["layerBlendMode"] = "screen";
            }
        }
        $layer["lineStyle"] = $lineStyle;
    }
    unset($layer);

    return $snapshot;
}

function normalize_particle_layer(array $layer): array {
    $type = $layer["type"] ?? null;
    if ($type === "volume") {
        $layer["type"] = "particles";
    }

    $particleStyle = $layer["particleStyle"] ?? null;
    $volumeStyle = $layer["volumeStyle"] ?? null;
    if ($particleStyle === null && is_array($volumeStyle)) {
        $particleStyle = $volumeStyle;
    }
    if ($volumeStyle === null && is_array($particleStyle)) {
        $volumeStyle = $particleStyle;
    }
    if ($particleStyle !== null) {
        $layer["particleStyle"] = $particleStyle;
    }
    if ($volumeStyle !== null) {
        $layer["volumeStyle"] = $volumeStyle;
    }

    return $layer;
}

if (isset($snapshot["properties"]["_pulse"]["layers"]) && is_array($snapshot["properties"]["_pulse"]["layers"])) {
    foreach ($snapshot["properties"]["_pulse"]["layers"] as &$layer) {
        if (!is_array($layer)) continue;
        $layer = normalize_particle_layer($layer);
    }
    unset($layer);
}

// Cap timeline duration and per-animation duration.
if (isset($snapshot["properties"]["_pulse"]["timeline"]["durationOverride"])) {
    $durationOverride = $snapshot["properties"]["_pulse"]["timeline"]["durationOverride"];
    if ($durationOverride === null) {
        $snapshot["properties"]["_pulse"]["timeline"]["durationOverride"] = 6;
    } else {
        $snapshot["properties"]["_pulse"]["timeline"]["durationOverride"] =
            clamp_duration($durationOverride, 60);
    }
}
if (isset($snapshot["properties"]["_pulse"]["layers"]) && is_array($snapshot["properties"]["_pulse"]["layers"])) {
    foreach ($snapshot["properties"]["_pulse"]["layers"] as &$layer) {
        if (!isset($layer["animations"]) || !is_array($layer["animations"])) continue;
        foreach ($layer["animations"] as &$anim) {
            if (isset($anim["duration"])) {
                $anim["duration"] = clamp_duration($anim["duration"], 60);
            }
            if (isset($anim["start"])) {
                $anim["start"] = clamp_duration($anim["start"], 60);
            }
        }
        unset($anim);
    }
    unset($layer);
}

function normalize_non_overlapping_animations(array $layer): array {
    if (!isset($layer["animations"]) || !is_array($layer["animations"])) {
        return $layer;
    }
    $type = $layer["type"] ?? "";
    $priority = [
        "polygon" => ["fill", "fadeIn", "fadeOut", "pulse"],
        "polyline" => ["draw", "drawReverse", "fadeIn", "fadeOut"],
        "point" => ["followPath", "fadeIn", "fadeOut", "pulse", "bounce", "spin", "grow"],
        "text" => ["typewriter", "fadeIn", "fadeOut", "bounce"],
        "feature" => ["field"],
        "particles" => ["smoke", "fire"],
        "volume" => ["smoke", "fire"]
    ];
    $priorityMap = [];
    foreach (($priority[$type] ?? []) as $idx => $t) {
        $priorityMap[$t] = $idx;
    }

    $anims = $layer["animations"];
    usort($anims, function ($a, $b) use ($priorityMap) {
        $aStart = is_numeric($a["start"] ?? null) ? (float) $a["start"] : 0;
        $bStart = is_numeric($b["start"] ?? null) ? (float) $b["start"] : 0;
        if ($aStart != $bStart) return $aStart <=> $bStart;
        $aType = $a["type"] ?? "";
        $bType = $b["type"] ?? "";
        $aPri = $priorityMap[$aType] ?? 999;
        $bPri = $priorityMap[$bType] ?? 999;
        if ($aPri != $bPri) return $aPri <=> $bPri;
        $aDur = is_numeric($a["duration"] ?? null) ? (float) $a["duration"] : 0;
        $bDur = is_numeric($b["duration"] ?? null) ? (float) $b["duration"] : 0;
        return $bDur <=> $aDur;
    });

    $kept = [];
    foreach ($anims as $anim) {
        $start = is_numeric($anim["start"] ?? null) ? (float) $anim["start"] : 0;
        $duration = is_numeric($anim["duration"] ?? null) ? (float) $anim["duration"] : 0;
        $end = $start + $duration;
        $overlaps = false;
        foreach ($kept as $keptAnim) {
            $kStart = is_numeric($keptAnim["start"] ?? null) ? (float) $keptAnim["start"] : 0;
            $kDuration = is_numeric($keptAnim["duration"] ?? null) ? (float) $keptAnim["duration"] : 0;
            $kEnd = $kStart + $kDuration;
            if ($start < $kEnd && $end > $kStart) {
                $overlaps = true;
                break;
            }
        }
        if (!$overlaps) {
            $kept[] = $anim;
        }
    }
    $layer["animations"] = $kept;
    return $layer;
}

if (isset($snapshot["properties"]["_pulse"]["layers"]) && is_array($snapshot["properties"]["_pulse"]["layers"])) {
    foreach ($snapshot["properties"]["_pulse"]["layers"] as &$layer) {
        if (!is_array($layer)) continue;
        $layer = normalize_non_overlapping_animations($layer);
    }
    unset($layer);
}

$desaturateRequested = preg_match("/desaturat(e|ed|ion)/i", $prompt) === 1;
$allowedBlendModes = [
    "normal",
    "average",
    "color-burn",
    "color-dodge",
    "color",
    "darken",
    "destination-atop",
    "destination-in",
    "destination-out",
    "destination-over",
    "difference",
    "exclusion",
    "hard-light",
    "hue",
    "invert",
    "lighten",
    "lighter",
    "luminosity",
    "multiply",
    "overlay",
    "saturation",
    "screen",
    "soft-light",
    "source-atop",
    "source-in",
    "source-out",
    "vivid-light",
    "xor"
];
if (isset($snapshot["properties"]["_pulse"]["layers"]) && is_array($snapshot["properties"]["_pulse"]["layers"])) {
    foreach ($snapshot["properties"]["_pulse"]["layers"] as &$layer) {
        $blend = $layer["layerBlendMode"] ?? null;
        if (!is_string($blend) || !in_array($blend, $allowedBlendModes, true)) {
            $blend = "normal";
        }
        if ($desaturateRequested && $blend === "normal") {
            $blend = "color";
        }
        $layer["layerBlendMode"] = $blend;
    }
    unset($layer);
}

function split_multiline_layers(array $snapshot): array {
    $features = $snapshot["features"] ?? [];
    $layers = $snapshot["properties"]["_pulse"]["layers"] ?? [];
    if (!is_array($features) || !is_array($layers)) {
        return $snapshot;
    }

    $featuresByLayer = [];
    foreach ($features as $idx => $feature) {
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (is_string($layerId)) {
            $featuresByLayer[$layerId][] = $idx;
        }
    }

    $newFeatures = $features;
    $newLayers = [];

    foreach ($layers as $layer) {
        $layerId = $layer["id"] ?? null;
        if (!is_string($layerId)) {
            $newLayers[] = $layer;
            continue;
        }
        $featureIndexes = $featuresByLayer[$layerId] ?? [];
        if (count($featureIndexes) !== 1) {
            $newLayers[] = $layer;
            continue;
        }
        $feature = $features[$featureIndexes[0]] ?? null;
        $geom = $feature["geometry"] ?? null;
        if (!is_array($geom) || ($geom["type"] ?? null) !== "MultiLineString") {
            $newLayers[] = $layer;
            continue;
        }
        $coords = $geom["coordinates"] ?? null;
        if (!is_array($coords) || count($coords) === 0) {
            $newLayers[] = $layer;
            continue;
        }

        // Split the MultiLineString into separate layers with staggered start times.
        $stagger = 0.25;
        foreach ($coords as $index => $lineCoords) {
            if (!is_array($lineCoords)) continue;
            $segId = $layerId . "-seg-" . ($index + 1);
            $segName = ($layer["name"] ?? $layerId) . " " . ($index + 1);

            $segFeature = $feature;
            $segFeature["geometry"] = [
                "type" => "LineString",
                "coordinates" => $lineCoords
            ];
            $segFeature["properties"]["_pulse"]["layerId"] = $segId;
            $newFeatures[] = $segFeature;

            $segLayer = $layer;
            $segLayer["id"] = $segId;
            $segLayer["name"] = $segName;
            if (isset($segLayer["animations"]) && is_array($segLayer["animations"])) {
                foreach ($segLayer["animations"] as &$anim) {
                    if (isset($anim["start"]) && is_numeric($anim["start"])) {
                        $anim["start"] = (float) $anim["start"] + ($stagger * $index);
                    }
                }
                unset($anim);
            }
            $newLayers[] = $segLayer;
        }

        // Remove original feature by marking it null.
        $newFeatures[$featureIndexes[0]] = null;
    }

    $snapshot["features"] = array_values(array_filter($newFeatures, fn($f) => $f !== null));
    $snapshot["properties"]["_pulse"]["layers"] = $newLayers;
    return $snapshot;
}

function split_multifeature_layers(array $snapshot): array {
    $features = $snapshot["features"] ?? [];
    $layers = $snapshot["properties"]["_pulse"]["layers"] ?? [];
    if (!is_array($features) || !is_array($layers)) {
        return $snapshot;
    }

    $featuresByLayer = [];
    foreach ($features as $idx => $feature) {
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (is_string($layerId)) {
            $featuresByLayer[$layerId][] = $idx;
        }
    }

    $newFeatures = $features;
    $newLayers = [];

    foreach ($layers as $layer) {
        $layerId = $layer["id"] ?? null;
        if (!is_string($layerId)) {
            $newLayers[] = $layer;
            continue;
        }
        $featureIndexes = $featuresByLayer[$layerId] ?? [];
        if (count($featureIndexes) <= 1) {
            $newLayers[] = $layer;
            continue;
        }

        // Split multiple features into separate layers with staggered start times.
        $stagger = 0.25;
        foreach ($featureIndexes as $i => $featIdx) {
            $feature = $features[$featIdx] ?? null;
            if (!is_array($feature)) continue;
            $segId = $layerId . "-feat-" . ($i + 1);
            $segName = ($layer["name"] ?? $layerId) . " " . ($i + 1);

            $segFeature = $feature;
            $segFeature["properties"]["_pulse"]["layerId"] = $segId;
            $newFeatures[$featIdx] = $segFeature;

            $segLayer = $layer;
            $segLayer["id"] = $segId;
            $segLayer["name"] = $segName;
            if (isset($segLayer["animations"]) && is_array($segLayer["animations"])) {
                foreach ($segLayer["animations"] as &$anim) {
                    if (isset($anim["start"]) && is_numeric($anim["start"])) {
                        $anim["start"] = (float) $anim["start"] + ($stagger * $i);
                    }
                }
                unset($anim);
            }
            $newLayers[] = $segLayer;
        }
    }

    $snapshot["features"] = array_values($newFeatures);
    $snapshot["properties"]["_pulse"]["layers"] = $newLayers;
    return $snapshot;
}

$snapshot = split_multiline_layers($snapshot);
$snapshot = split_multifeature_layers($snapshot);
$snapshot = apply_showcase_app_defaults($snapshot, $prompt);
$snapshot = apply_intent_visual_defaults_v2($snapshot, $prompt);
$snapshot = ensure_transport_follow_path_layers_v2($snapshot, $prompt);
$snapshot = ensure_showcase_labels_v2($snapshot, $prompt);
$snapshot = normalize_transport_point_styles_for_mode($snapshot);
if (isset($snapshot["properties"]["_pulse"]["layers"]) && is_array($snapshot["properties"]["_pulse"]["layers"])) {
    foreach ($snapshot["properties"]["_pulse"]["layers"] as &$layer) {
        if (!is_array($layer)) continue;
        $layer = normalize_non_overlapping_animations($layer);
    }
    unset($layer);
}
$snapshot = sort_snapshot_layers($snapshot);
$snapshot = repair_feature_layer_links($snapshot);


// Ensure durationOverride covers the latest animation end, capped at 60.
if (isset($snapshot["properties"]["_pulse"]["layers"]) && is_array($snapshot["properties"]["_pulse"]["layers"])) {
    $maxEnd = 0;
    foreach ($snapshot["properties"]["_pulse"]["layers"] as $layer) {
        if (!isset($layer["animations"]) || !is_array($layer["animations"])) continue;
        foreach ($layer["animations"] as $anim) {
            if (!is_array($anim)) continue;
            $start = is_numeric($anim["start"] ?? null) ? (float) $anim["start"] : 0;
            $duration = is_numeric($anim["duration"] ?? null) ? (float) $anim["duration"] : 0;
            $maxEnd = max($maxEnd, $start + $duration);
        }
    }
    $maxEnd = clamp_duration($maxEnd, 60);
    $currentDuration = $snapshot["properties"]["_pulse"]["timeline"]["durationOverride"] ?? null;
    if ($currentDuration === null || (is_numeric($currentDuration) && (float) $currentDuration < $maxEnd)) {
        $snapshot["properties"]["_pulse"]["timeline"]["durationOverride"] = $maxEnd ?: $currentDuration;
    }
}

function validate_snapshot(array $data): ?string {
    if (($data["type"] ?? null) !== "FeatureCollection") {
        return "Invalid type";
    }
    if (!isset($data["features"]) || !is_array($data["features"])) {
        return "Missing features";
    }
    $pulse = $data["properties"]["_pulse"] ?? null;
    if (!is_array($pulse)) {
        return "Missing properties._pulse";
    }
    if (!isset($pulse["app"]) || !is_array($pulse["app"])) {
        return "Missing properties._pulse.app";
    }
    if (!isset($pulse["timeline"]) || !is_array($pulse["timeline"])) {
        return "Missing properties._pulse.timeline";
    }
    if (!isset($pulse["layers"]) || !is_array($pulse["layers"])) {
        return "Missing properties._pulse.layers";
    }
    $allowedAnimationsByLayer = [
        "point" => ["fadeIn", "fadeOut", "pulse", "bounce", "spin", "grow", "followPath"],
        "polyline" => ["draw", "drawReverse", "fadeIn", "fadeOut"],
        "polygon" => ["fadeIn", "fadeOut", "fill", "pulse"],
        "text" => ["fadeIn", "fadeOut", "typewriter", "bounce"],
        "feature" => ["field"],
        "particles" => ["smoke", "fire"],
        "volume" => ["smoke", "fire"]
    ];
    $allowedPointStyles = [
        "circle",
        "square",
        "diamond",
        "triangle",
        "cross",
        "x",
        "home",
        "map-pin",
        "star",
        "hexagon",
        "pentagon",
        "octagon",
        "heart",
        "drop",
        "shield",
        "flag",
        "phosphor-map-pin",
        "phosphor-map-pin-line",
        "phosphor-map-pin-plus",
        "phosphor-map-pin-simple",
        "phosphor-map-pin-simple-line",
        "phosphor-map-trifold",
        "phosphor-navigation-arrow",
        "phosphor-compass",
        "phosphor-compass-rose",
        "phosphor-crosshair",
        "phosphor-crosshair-simple",
        "phosphor-push-pin",
        "phosphor-push-pin-simple",
        "phosphor-push-pin-slash",
        "phosphor-push-pin-simple-slash",
        "phosphor-path",
        "phosphor-flag",
        "phosphor-flag-banner",
        "phosphor-flag-checkered",
        "phosphor-flag-pennant",
        "phosphor-car",
        "phosphor-car-simple",
        "phosphor-taxi",
        "phosphor-bus",
        "phosphor-train",
        "phosphor-tram",
        "phosphor-subway",
        "phosphor-airplane",
        "phosphor-airplane-landing",
        "phosphor-airplane-takeoff",
        "phosphor-bicycle",
        "phosphor-motorcycle",
        "phosphor-scooter",
        "phosphor-boat",
        "phosphor-truck",
        "phosphor-van",
        "phosphor-cable-car",
        "phosphor-anchor",
        "phosphor-lifebuoy",
        "phosphor-lighthouse",
        "phosphor-house",
        "phosphor-house-simple",
        "phosphor-building",
        "phosphor-building-office",
        "phosphor-buildings",
        "phosphor-hospital",
        "phosphor-student",
        "phosphor-graduation-cap",
        "phosphor-police-car",
        "phosphor-fire-truck",
        "model-car",
        "model-bus",
        "model-train",
        "model-boat",
        "model-airplane",
        "phosphor-church",
        "phosphor-bank",
        "phosphor-gas-pump",
        "phosphor-charging-station",
        "phosphor-plug-charging",
        "phosphor-coffee",
        "phosphor-bowl-food",
        "phosphor-fork-knife",
        "phosphor-park",
        "phosphor-tree",
        "phosphor-mountains",
        "phosphor-bridge",
        "phosphor-tent",
        "phosphor-bed",
        "phosphor-number-circle-zero",
        "phosphor-number-circle-one",
        "phosphor-number-circle-two",
        "phosphor-number-circle-three",
        "phosphor-number-circle-four",
        "phosphor-number-circle-five",
        "phosphor-number-circle-six",
        "phosphor-number-circle-seven",
        "phosphor-number-circle-eight",
        "phosphor-number-circle-nine"
    ];
    $allowedLineStyles = [
        "solid",
        "arrow-start",
        "arrow-end",
        "arrow-both",
        "dash",
        "dot",
        "dash-dot",
        "short-dash",
        "short-dot",
        "short-dash-dot",
        "short-dash-dot-dot",
        "long-dash",
        "long-dash-dot",
        "tube-3d"
    ];
    $allowedPolygonStyles = [
        "solid",
        "backward-diagonal",
        "forward-diagonal",
        "diagonal-cross",
        "cross",
        "horizontal",
        "vertical",
        "none"
    ];
    $allowedOutlineStyles = [
        "solid",
        "dash",
        "dot",
        "dash-dot",
        "short-dash",
        "short-dot",
        "short-dash-dot",
        "short-dash-dot-dot",
        "long-dash",
        "long-dash-dot"
    ];
    $allowedBlendModes = [
        "normal",
        "average",
        "color-burn",
        "color-dodge",
        "color",
        "darken",
        "destination-atop",
        "destination-in",
        "destination-out",
        "destination-over",
        "difference",
        "exclusion",
        "hard-light",
        "hue",
        "invert",
        "lighten",
        "lighter",
        "luminosity",
        "multiply",
        "overlay",
        "saturation",
        "screen",
        "soft-light",
        "source-atop",
        "source-in",
        "source-out",
        "vivid-light",
        "xor"
    ];
    $allowedParticlePresets = [
        "balanced",
        "bonfire",
        "jet-flame",
        "heavy-smoke",
        "steam-vent",
        "dust-plume"
    ];
    $allowedEmitterModes = ["box", "emitter"];
    $layerIds = [];
    $layerTypesById = [];
    foreach ($pulse["layers"] as $layer) {
        if (!is_array($layer)) {
            return "Invalid layer entry";
        }
        $id = $layer["id"] ?? "";
        if (!is_string($id) || $id === "") {
            return "Layer missing id";
        }
        $layerType = $layer["type"] ?? null;
        if (!is_string($layerType) || !isset($allowedAnimationsByLayer[$layerType])) {
            return "Invalid layer type";
        }
        $anims = $layer["animations"] ?? [];
        if (!is_array($anims)) {
            return "Layer animations must be an array";
        }
        foreach ($anims as $anim) {
            if (!is_array($anim)) {
                return "Invalid animation entry";
            }
            $animType = $anim["type"] ?? null;
            if (!is_string($animType) || !in_array($animType, $allowedAnimationsByLayer[$layerType], true)) {
                return "Invalid animation type for layer";
            }
            if ($animType === "followPath") {
                $pathLayerId = $anim["pathLayerId"] ?? null;
                if (!is_string($pathLayerId) || trim($pathLayerId) === "") {
                    return "followPath animation missing pathLayerId";
                }
                if (!array_key_exists("orientToPath", $anim) || !is_bool($anim["orientToPath"])) {
                    return "followPath animation missing orientToPath";
                }
                if (!array_key_exists("reverse", $anim) || !is_bool($anim["reverse"])) {
                    return "followPath animation missing reverse";
                }
                if (!array_key_exists("smoothFollow", $anim) || !is_bool($anim["smoothFollow"])) {
                    return "followPath animation missing smoothFollow";
                }
            }
        }
        $pointStyle = $layer["pointStyle"] ?? null;
        if (is_array($pointStyle)) {
            $style = $pointStyle["style"] ?? null;
            if (!is_string($style) || !in_array($style, $allowedPointStyles, true)) {
                return "Invalid point style";
            }
        }
        $lineStyle = $layer["lineStyle"] ?? null;
        if (is_array($lineStyle)) {
            $style = $lineStyle["style"] ?? null;
            if (!is_string($style) || !in_array($style, $allowedLineStyles, true)) {
                return "Invalid line style";
            }
        }
        $polygonStyle = $layer["polygonStyle"] ?? null;
        if (is_array($polygonStyle)) {
            $style = $polygonStyle["style"] ?? null;
            if (!is_string($style) || !in_array($style, $allowedPolygonStyles, true)) {
                return "Invalid polygon style";
            }
            $outlineStyle = $polygonStyle["outlineStyle"] ?? null;
            if ($outlineStyle !== null && (!is_string($outlineStyle) || !in_array($outlineStyle, $allowedOutlineStyles, true))) {
                return "Invalid polygon outline style";
            }
        }
        $blend = $layer["layerBlendMode"] ?? null;
        if ($blend !== null && (!is_string($blend) || !in_array($blend, $allowedBlendModes, true))) {
            return "Invalid blend mode";
        }
        foreach (["particleStyle", "volumeStyle"] as $particleStyleKey) {
            $particleStyle = $layer[$particleStyleKey] ?? null;
            if (!is_array($particleStyle)) {
                continue;
            }
            $preset = $particleStyle["preset"] ?? null;
            if ($preset !== null && (!is_string($preset) || !in_array($preset, $allowedParticlePresets, true))) {
                return "Invalid particle preset";
            }
            $emitterMode = $particleStyle["emitterMode"] ?? null;
            if ($emitterMode !== null && (!is_string($emitterMode) || !in_array($emitterMode, $allowedEmitterModes, true))) {
                return "Invalid particle emitter mode";
            }
        }
        $layerIds[$id] = true;
        $layerTypesById[$id] = $layerType === "volume" ? "particles" : $layerType;
    }
    foreach ($pulse["layers"] as $layer) {
        if (!is_array($layer) || ($layer["type"] ?? null) !== "point") {
            continue;
        }
        $anims = $layer["animations"] ?? [];
        if (!is_array($anims)) {
            continue;
        }
        foreach ($anims as $anim) {
            if (!is_array($anim) || ($anim["type"] ?? null) !== "followPath") {
                continue;
            }
            $pathLayerId = trim((string) ($anim["pathLayerId"] ?? ""));
            if (!isset($layerTypesById[$pathLayerId])) {
                return "followPath pathLayerId does not match a layer";
            }
            if ($layerTypesById[$pathLayerId] !== "polyline") {
                return "followPath pathLayerId must reference a polyline layer";
            }
        }
    }
    foreach ($data["features"] as $feature) {
        if (!is_array($feature)) {
            return "Invalid feature entry";
        }
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (!is_string($layerId) || !isset($layerIds[$layerId])) {
            return "Feature layerId does not match a layer";
        }
    }
    return null;
}

function collect_snapshot_link_debug(array $data): array {
    $layerIds = [];
    foreach (($data["properties"]["_pulse"]["layers"] ?? []) as $layer) {
        if (is_array($layer) && is_string($layer["id"] ?? null) && $layer["id"] !== "") {
            $layerIds[$layer["id"]] = true;
        }
    }
    $orphanFeatureLayerIds = [];
    foreach (($data["features"] ?? []) as $feature) {
        $layerId = $feature["properties"]["_pulse"]["layerId"] ?? null;
        if (is_string($layerId) && !isset($layerIds[$layerId])) {
            $orphanFeatureLayerIds[$layerId] = true;
        }
    }
    return [
        "layer_count" => count($layerIds),
        "feature_count" => is_array($data["features"] ?? null) ? count($data["features"]) : 0,
        "orphan_feature_layer_ids" => array_values(array_keys($orphanFeatureLayerIds))
    ];
}

$validationError = validate_snapshot($snapshot);
if ($validationError) {
    http_response_code(422);
    echo json_encode([
        "error" => $validationError,
        "details" => collect_snapshot_link_debug($snapshot)
    ]);
    exit;
}

echo json_encode($snapshot);
