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

// Extend script execution time for slow upstream calls.
@set_time_limit(120);

header("Content-Type: application/json; charset=utf-8");

$allowedOrigin = getenv("PULSE_ALLOWED_ORIGIN");
if ($allowedOrigin) {
    header("Access-Control-Allow-Origin: " . $allowedOrigin);
    header("Vary: Origin");
}

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    if ($allowedOrigin) {
        header("Access-Control-Allow-Methods: POST, OPTIONS");
        header("Access-Control-Allow-Headers: Content-Type");
    }
    http_response_code(204);
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
    $wantsRoute = preg_match('/\b(route|routing|drive|driving|directions|travel)\b/i', $prompt) === 1;
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

$model = getenv("OPENAI_MODEL") ?: "gpt-4.1-mini";
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
                                        "enum" => ["point", "polyline", "polygon", "text", "feature"]
                                    ],
                                    "animations" => [
                                        "type" => "array",
                                        "items" => [
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
                                                        "field"
                                                    ]
                                                ],
                                                "duration" => ["type" => "number"],
                                                "start" => ["type" => "number"]
                                            ],
                                            "required" => ["type", "duration", "start"]
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
    "point=[fadeIn, fadeOut, pulse, bounce, spin, grow], " .
    "polyline=[draw, drawReverse, fadeIn, fadeOut], " .
    "polygon=[fadeIn, fadeOut, fill, pulse], " .
    "text=[fadeIn, fadeOut, typewriter, bounce], " .
    "feature=[field]. " .
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
    "phosphor-hospital, phosphor-student, phosphor-graduation-cap, phosphor-police-car, phosphor-fire-truck, phosphor-church, " .
    "phosphor-bank, phosphor-gas-pump, phosphor-charging-station, phosphor-plug-charging, phosphor-coffee, phosphor-bowl-food, " .
    "phosphor-fork-knife, phosphor-park, phosphor-tree, phosphor-mountains, phosphor-bridge, phosphor-tent, phosphor-bed, " .
    "phosphor-number-circle-zero, phosphor-number-circle-one, phosphor-number-circle-two, phosphor-number-circle-three, " .
    "phosphor-number-circle-four, phosphor-number-circle-five, phosphor-number-circle-six, phosphor-number-circle-seven, " .
    "phosphor-number-circle-eight, phosphor-number-circle-nine]. " .
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
    "max_output_tokens" => 4000,
    "store" => false
];

$ch = curl_init("https://api.openai.com/v1/responses");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer " . $apiKey,
    "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($requestBody));
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
curl_setopt($ch, CURLOPT_TIMEOUT, 60);

$responseBody = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
if ($responseBody === false) {
    $err = curl_error($ch);
    $errno = curl_errno($ch);
    http_response_code(502);
    echo json_encode([
        "error" => "Upstream request failed",
        "details" => [
            "curl_errno" => $errno,
            "curl_error" => $err
        ]
    ]);
    exit;
}
// curl_close() is deprecated in PHP 8.5+, and is a no-op since PHP 8.0.

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
        "details" => $responseData
    ]);
    exit;
}

function extract_output_text(array $data): ?string {
    if (isset($data["output_text"]) && is_string($data["output_text"])) {
        return $data["output_text"];
    }
    if (!isset($data["output"]) || !is_array($data["output"])) {
        return null;
    }
    foreach ($data["output"] as $item) {
        if (!is_array($item) || ($item["type"] ?? "") !== "message") {
            continue;
        }
        $content = $item["content"] ?? null;
        if (!is_array($content)) {
            continue;
        }
        foreach ($content as $part) {
            if (is_array($part) && ($part["type"] ?? "") === "output_text") {
                $text = $part["text"] ?? null;
                if (is_string($text)) {
                    return $text;
                }
            }
        }
    }
    return null;
}

$jsonText = extract_output_text($responseData);
if (!$jsonText) {
    http_response_code(502);
    echo json_encode(["error" => "Missing model output"]);
    exit;
}

$snapshot = json_decode($jsonText, true);
if (!is_array($snapshot)) {
    http_response_code(502);
    echo json_encode(["error" => "Model output was not valid JSON"]);
    exit;
}

// Normalize a few core fields for safety.
$snapshot["properties"]["_pulse"]["version"] = 1;
$snapshot["properties"]["_pulse"]["savedAt"] = gmdate("c");
if (is_array($routeLineCoords) && isset($routeLineCoords[0]["coords"])) {
    // Apply routed geometry to separate polyline layers.
    $baseLayer = null;
    foreach ($snapshot["properties"]["_pulse"]["layers"] as $layer) {
        if (($layer["type"] ?? null) === "polyline") {
            $baseLayer = $layer;
            break;
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

    foreach ($routeLineCoords as $idx => $route) {
        $layerId = "route-" . ($idx + 1);
        $layerName = "Route " . ($idx + 1);
        if (!empty($route["from"]) && !empty($route["to"])) {
            $layerName = $route["from"] . " to " . $route["to"];
        }

        $layer = $baseLayer;
        $layer["id"] = $layerId;
        $layer["name"] = $layerName;
        $layer["animations"] = [
            ["type" => "draw", "duration" => $duration, "start" => 0]
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
        "point" => ["fadeIn", "fadeOut", "pulse", "bounce", "spin", "grow"],
        "text" => ["typewriter", "fadeIn", "fadeOut", "bounce"],
        "feature" => ["field"]
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
        "point" => ["fadeIn", "fadeOut", "pulse", "bounce", "spin", "grow"],
        "polyline" => ["draw", "drawReverse", "fadeIn", "fadeOut"],
        "polygon" => ["fadeIn", "fadeOut", "fill", "pulse"],
        "text" => ["fadeIn", "fadeOut", "typewriter", "bounce"],
        "feature" => ["field"]
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
    $layerIds = [];
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
        $layerIds[$id] = true;
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

$validationError = validate_snapshot($snapshot);
if ($validationError) {
    http_response_code(422);
    echo json_encode(["error" => $validationError]);
    exit;
}

echo json_encode($snapshot);
