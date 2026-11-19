<?php
header('Content-Type: application/json');

require_once __DIR__ . '/config.php';
$PADDLE_API_KEY = PADDLE_API_KEY;
$PADDLE_API_URL = "https://api.paddle.com";

$data = json_decode(file_get_contents('php://input'), true);
$email = filter_var($data['email'] ?? '', FILTER_SANITIZE_EMAIL);

if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => 'Email is required']);
    exit;
}

function paddle_request($endpoint, $apiKey, $method = 'GET', $body = null) {
    global $PADDLE_API_URL;
    $ch = curl_init("$PADDLE_API_URL$endpoint");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $headers = ["Authorization: Bearer $apiKey", "Content-Type: application/json"];
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $httpCode, 'data' => json_decode($response, true)];
}

$customerRes = paddle_request("/customers?search=" . urlencode($email), $PADDLE_API_KEY);
if (empty($customerRes['data']['data'])) {
    http_response_code(404);
    echo json_encode(['error' => 'Customer not found']);
    exit;
}

$customerId = $customerRes['data']['data'][0]['id'];
$subRes = paddle_request("/subscriptions?customer_id=$customerId&status=active", $PADDLE_API_KEY);

if (empty($subRes['data']['data'])) {
    http_response_code(404);
    echo json_encode(['error' => 'No active subscription found']);
    exit;
}

$subscriptionId = $subRes['data']['data'][0]['id'];
$cancelRes = paddle_request("/subscriptions/$subscriptionId/cancel", $PADDLE_API_KEY, 'POST', ['effective_from' => 'next_billing_period']);

if ($cancelRes['code'] === 200) {
    echo json_encode(['success' => true, 'message' => 'Subscription cancelled at end of billing period.']);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to cancel subscription', 'details' => $cancelRes['data']]);
}
?>
