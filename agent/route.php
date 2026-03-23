<?php
declare(strict_types=1);

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

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit;
}

$arcgisApiKey = getenv("ARCGIS_API_KEY");
if (!$arcgisApiKey) {
    http_response_code(500);
    echo json_encode(["error" => "Server misconfigured: missing ARCGIS_API_KEY"]);
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

$from = isset($payload["from"]) ? trim((string) $payload["from"]) : "";
$to = isset($payload["to"]) ? trim((string) $payload["to"]) : "";
$mode = strtolower(trim((string) ($payload["mode"] ?? "drive")));
$name = isset($payload["name"]) ? trim((string) $payload["name"]) : "";

if ($from === "" || $to === "") {
    http_response_code(400);
    echo json_encode(["error" => "Missing start or end location"]);
    exit;
}

if (strlen($from) > 200 || strlen($to) > 200 || strlen($name) > 200) {
    http_response_code(413);
    echo json_encode(["error" => "Route fields are too long"]);
    exit;
}

if (!in_array($mode, ["drive", "walk"], true)) {
    http_response_code(400);
    echo json_encode(["error" => "Unsupported travel mode"]);
    exit;
}

function get_route_daily_limit() {
    $raw = getenv("PULSE_ROUTE_DAILY_LIMIT");
    if ($raw === false || trim((string) $raw) === "") {
        return 1000;
    }
    $limit = (int) $raw;
    return $limit > 0 ? $limit : 0;
}

function get_route_usage_dir() {
    $configured = trim((string) (getenv("PULSE_ROUTE_USAGE_DIR") ?: ""));
    if ($configured !== "") {
        return rtrim($configured, "\\/");
    }
    return rtrim(sys_get_temp_dir(), "\\/") . DIRECTORY_SEPARATOR . "pulse3-route-usage";
}

function reserve_daily_route_slot($limit) {
    if ($limit <= 0) {
        return [[
            "date" => gmdate("Y-m-d"),
            "count" => 0,
            "limit" => 0,
            "remaining" => null
        ], null];
    }

    $date = gmdate("Y-m-d");
    $dir = get_route_usage_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return [null, ["error" => "route_usage_storage_unavailable", "path" => $dir]];
    }

    $filePath = $dir . DIRECTORY_SEPARATOR . $date . ".json";
    $handle = @fopen($filePath, "c+");
    if ($handle === false) {
        return [null, ["error" => "route_usage_file_unavailable", "path" => $filePath]];
    }

    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        return [null, ["error" => "route_usage_lock_failed", "path" => $filePath]];
    }

    $contents = stream_get_contents($handle);
    $state = json_decode($contents ?: "", true);
    if (!is_array($state)) {
        $state = [
            "date" => $date,
            "count" => 0
        ];
    }

    $count = (int) ($state["count"] ?? 0);
    if ($count >= $limit) {
        flock($handle, LOCK_UN);
        fclose($handle);
        return [null, [
            "error" => "daily_route_limit_reached",
            "date" => $date,
            "count" => $count,
            "limit" => $limit
        ]];
    }

    $count += 1;
    $nextState = [
        "date" => $date,
        "count" => $count,
        "limit" => $limit,
        "updatedAt" => gmdate("c")
    ];

    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, json_encode($nextState, JSON_PRETTY_PRINT));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return [[
        "date" => $date,
        "count" => $count,
        "limit" => $limit,
        "remaining" => max(0, $limit - $count)
    ], null];
}

function arcgis_request($url, $params, $apiKey, $method = "POST") {
    $method = strtoupper((string) $method);
    $params["f"] = $params["f"] ?? "json";
    $params["token"] = $apiKey;

    $ch = curl_init();
    if ($method === "GET") {
        $query = http_build_query($params);
        curl_setopt($ch, CURLOPT_URL, $url . (str_contains($url, "?") ? "&" : "?") . $query);
        curl_setopt($ch, CURLOPT_HTTPGET, true);
    } else {
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/x-www-form-urlencoded"]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
    }

    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
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
        "category" => "Address,Postal,Populated Place",
        "locationType" => "street"
    ];
    [$data, $err] = arcgis_request($url, $params, $apiKey, "POST");
    if ($err || !isset($data["candidates"][0]["location"])) {
        return [null, $err ?? ["error" => "no_candidates"]];
    }
    $loc = $data["candidates"][0]["location"];
    if (!isset($loc["x"], $loc["y"])) {
        return [null, ["error" => "invalid_location"]];
    }
    return [[(float) $loc["x"], (float) $loc["y"]], null];
}

function fetch_route_travel_modes($apiKey) {
    $url = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes";
    [$data, $err] = arcgis_request($url, [], $apiKey, "POST");
    if ($err) {
        return [null, $err];
    }

    $supportedTravelModes = $data["supportedTravelModes"] ?? null;
    if (!is_array($supportedTravelModes) || count($supportedTravelModes) === 0) {
        return [null, ["error" => "travel_modes_unavailable"]];
    }

    return [[
        "supported" => $supportedTravelModes,
        "default" => is_array($data["defaultTravelMode"] ?? null) ? $data["defaultTravelMode"] : null
    ], null];
}

function normalize_text($value) {
    return strtolower(trim((string) $value));
}

function resolve_travel_mode($apiKey, $mode) {
    [$bundle, $err] = fetch_route_travel_modes($apiKey);
    if ($err || !is_array($bundle)) {
        return [null, $err ?? ["error" => "travel_modes_unavailable"]];
    }

    $supported = $bundle["supported"] ?? [];
    $default = $bundle["default"] ?? null;
    $targets = $mode === "walk"
        ? ["walking time", "walking distance"]
        : ["driving time", "driving distance"];

    foreach ($supported as $travelMode) {
        if (!is_array($travelMode)) {
            continue;
        }
        $name = normalize_text($travelMode["name"] ?? "");
        if (in_array($name, $targets, true)) {
            return [$travelMode, null];
        }
    }

    foreach ($supported as $travelMode) {
        if (!is_array($travelMode)) {
            continue;
        }
        $impedance = normalize_text($travelMode["impedanceAttributeName"] ?? "");
        $restrictionsRaw = is_array($travelMode["restrictionAttributeNames"] ?? null)
            ? $travelMode["restrictionAttributeNames"]
            : [];
        $restrictions = array_map("normalize_text", $restrictionsRaw);
        if ($mode === "walk") {
            if ($impedance === "walk-time" || in_array("walking", $restrictions, true)) {
                return [$travelMode, null];
            }
            continue;
        }
        if ($impedance === "travel-time" || in_array("driving-an-automobile", $restrictions, true)) {
            return [$travelMode, null];
        }
    }

if ($mode === "drive" && is_array($default)) {
        return [$default, null];
    }

    return [null, ["error" => "travel_mode_not_found", "mode" => $mode]];
}

function route_between($from, $to, $apiKey, $travelMode) {
    $url = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World/solve";
    $stops = $from[0] . "," . $from[1] . ";" . $to[0] . "," . $to[1];
    $params = [
        "stops" => $stops,
        "outSR" => 4326,
        "returnRoutes" => true,
        "returnDirections" => false,
        "outputLines" => "esriNAOutputLineTrueShape",
        "simplifyOutput" => "false",
        "travelMode" => json_encode($travelMode, JSON_UNESCAPED_SLASHES)
    ];
    [$data, $err] = arcgis_request($url, $params, $apiKey, "POST");
    if ($err || !isset($data["routes"]["features"][0]["geometry"]["paths"][0])) {
        return [null, $err ?? ["error" => "no_route"]];
    }

    $path = $data["routes"]["features"][0]["geometry"]["paths"][0];
    if (!is_array($path) || count($path) < 2) {
        return [null, ["error" => "empty_paths"]];
    }

    return [$path, null];
}

function build_extent($coords) {
    $xs = [];
    $ys = [];
    foreach ($coords as $point) {
        if (!is_array($point) || count($point) < 2) {
            continue;
        }
        $xs[] = (float) $point[0];
        $ys[] = (float) $point[1];
    }
    if (!$xs || !$ys) {
        return null;
    }
    return [
        "xmin" => min($xs),
        "ymin" => min($ys),
        "xmax" => max($xs),
        "ymax" => max($ys),
        "wkid" => 4326
    ];
}

$dailyRouteLimit = get_route_daily_limit();
[$usageState, $usageErr] = reserve_daily_route_slot($dailyRouteLimit);
if ($usageErr) {
    if (($usageErr["error"] ?? null) === "daily_route_limit_reached") {
        http_response_code(429);
        echo json_encode([
            "error" => "Daily route limit reached",
            "details" => [
                "date" => $usageErr["date"] ?? gmdate("Y-m-d"),
                "count" => $usageErr["count"] ?? $dailyRouteLimit,
                "limit" => $usageErr["limit"] ?? $dailyRouteLimit,
                "hint" => "Try again tomorrow or raise PULSE_ROUTE_DAILY_LIMIT."
            ]
        ]);
        exit;
    }
    http_response_code(503);
    echo json_encode([
        "error" => "Route usage tracking is unavailable",
        "details" => $usageErr
    ]);
    exit;
}

[$travelMode, $travelModeErr] = resolve_travel_mode($arcgisApiKey, $mode);
if ($travelModeErr || !is_array($travelMode)) {
    http_response_code(502);
    echo json_encode([
        "error" => "Unable to load ArcGIS travel modes",
        "details" => $travelModeErr
    ]);
    exit;
}

[$fromCoord, $fromErr] = geocode_place($from, $arcgisApiKey);
if (!$fromCoord) {
    http_response_code(422);
    echo json_encode([
        "error" => "Could not find the start location",
        "details" => ["location" => $from, "cause" => $fromErr]
    ]);
    exit;
}

[$toCoord, $toErr] = geocode_place($to, $arcgisApiKey);
if (!$toCoord) {
    http_response_code(422);
    echo json_encode([
        "error" => "Could not find the end location",
        "details" => ["location" => $to, "cause" => $toErr]
    ]);
    exit;
}

[$coords, $routeErr] = route_between($fromCoord, $toCoord, $arcgisApiKey, $travelMode);
if (!$coords) {
    http_response_code(422);
    echo json_encode([
        "error" => $mode === "walk"
            ? "Could not build a walking route between those locations"
            : "Could not build a driving route between those locations",
        "details" => $routeErr
    ]);
    exit;
}

$layerName = $name !== "" ? $name : ($from . " to " . $to);

echo json_encode([
    "name" => $layerName,
    "mode" => $mode,
    "resolvedModeName" => $travelMode["name"] ?? null,
    "usage" => $usageState,
    "geometry" => [
        "type" => "LineString",
        "coordinates" => $coords
    ],
    "extent" => build_extent($coords)
]);
