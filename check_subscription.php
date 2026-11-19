<?php
header('Content-Type: application/json');

require_once __DIR__ . '/config.php';
$PADDLE_API_KEY = PADDLE_API_KEY;
$PADDLE_API_URL = "https://api.paddle.com";

$PRO_PRICES = [
    'pri_01kg5bx13n3m7ts4e47fz7xm62',  // legacy monthly
    'pri_01kg5by6qyxm19wb79rhrjmgt8',  // yearly
    'pri_01m1kg1q6x5tvajs5xap2ms0xe',  // current monthly
];

$data = json_decode(file_get_contents('php://input'), true);
$email = filter_var($data['email'] ?? '', FILTER_SANITIZE_EMAIL);

if (!$email) {
    http_response_code(400);
    echo json_encode(['error' => 'Email is required']);
    exit;
}

function paddle_request($endpoint, $apiKey) {
    global $PADDLE_API_URL;
    $ch = curl_init("$PADDLE_API_URL$endpoint");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Authorization: Bearer $apiKey",
        "Content-Type: application/json"
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false || $curlError !== '') return ['ok' => false, 'reason' => 'network_error: ' . $curlError];
    $decoded = json_decode($response, true);
    if ($httpCode < 200 || $httpCode >= 300) return ['ok' => false, 'reason' => 'http_' . $httpCode];
    if (!is_array($decoded)) return ['ok' => false, 'reason' => 'invalid_json'];
    return ['ok' => true, 'data' => $decoded];
}

function respond_unknown($reason) {
    echo json_encode(['isPro' => null, 'status' => 'unknown', 'plan' => null, 'reason' => $reason]);
    exit;
}

$customerResult = paddle_request("/customers?search=" . urlencode($email), $PADDLE_API_KEY);
if (!$customerResult['ok']) respond_unknown($customerResult['reason']);

if (empty($customerResult['data']['data'])) {
    echo json_encode(['isPro' => false, 'status' => 'not_found', 'plan' => null]);
    exit;
}

$customerId = $customerResult['data']['data'][0]['id'];
$subResult = paddle_request("/subscriptions?customer_id=$customerId&status=active", $PADDLE_API_KEY);
if (!$subResult['ok']) respond_unknown($subResult['reason']);

$isPro = false;
$activePlan = null;
$activeSubObject = null;

foreach ($subResult['data']['data'] as $sub) {
    foreach ($sub['items'] as $item) {
        if (in_array($item['price']['id'], $PRO_PRICES)) {
            $isPro = true;
            $activePlan = $item['price']['id'];
            $activeSubObject = $sub;
            break 2;
        }
    }
}

$response = ['isPro' => $isPro, 'status' => $isPro ? 'active' : 'no_active_subscription', 'plan' => $activePlan];

if ($isPro && $activeSubObject) {
    $details = [
        'status' => $activeSubObject['status'],
        'next_billed_at' => $activeSubObject['next_billed_at'] ?? null,
        'currency_code' => $activeSubObject['currency_code'] ?? 'USD'
    ];
    $txnResult = paddle_request("/transactions?subscription_id=" . $activeSubObject['id'] . "&status=completed&order_by=created_at[DESC]&per_page=1", $PADDLE_API_KEY);
    if ($txnResult['ok'] && !empty($txnResult['data']['data'])) {
        $lastTxn = $txnResult['data']['data'][0];
        $details['last_amount'] = $lastTxn['details']['totals']['total'] ?? '0.00';
        $details['last_payment_date'] = $lastTxn['created_at'] ?? null;
        $details['invoice_id'] = $lastTxn['invoice_number'] ?? $lastTxn['id'] ?? 'N/A';
        if (!empty($lastTxn['payments'])) {
            $payment = $lastTxn['payments'][0];
            $methodDetails = $payment['method_details'] ?? [];
            if (($methodDetails['type'] ?? '') === 'card' && isset($methodDetails['card'])) {
                $details['payment_method'] = ucfirst($methodDetails['card']['type'] ?? 'Card') . ' ending in ' . ($methodDetails['card']['last4'] ?? '????');
            } else {
                $details['payment_method'] = ucfirst($methodDetails['type'] ?? 'Unknown');
            }
        }
    }
    $response['details'] = $details;
}

echo json_encode($response);
?>
