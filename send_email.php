<?php
header('Content-Type: application/json');

// Configuration
$recipient_email = "support@arabic-ocr.com";

// Only accept POST requests
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit;
}

// 1. Robot Check (Honeypot)
if (!empty($_POST['honeypot'])) {
    echo json_encode(["success" => true, "message" => "Sent"]); 
    exit;
}

// reCAPTCHA v3 Validation
if (empty($_POST['recaptcha_token'])) {
    echo json_encode(["success" => false, "message" => "reCAPTCHA token missing."]);
    exit;
}

$token = $_POST['recaptcha_token'];
$action = 'submit';

// Verify reCAPTCHA via Cloudflare Worker (key stored in worker env.RECAPTCHA_API_KEY)
$workerUrl = "https://arabicocr.zczvwz6pw7.workers.dev/contact/recaptcha";
$payload = json_encode([
    "token"     => $token,
    "siteKey"   => "6LfReqgtAAAAAMB5fwAruBn0tI48BDOpUvr98BCl",
    "projectId" => "arabic-ocr-a89ec",
    "action"    => $action,
]);

$ch = curl_init($workerUrl);
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
$response = curl_exec($ch);
$curlError = curl_error($ch);
curl_close($ch);

if ($response === false || !empty($curlError)) {
    error_log("reCAPTCHA worker curl error: $curlError");
    echo json_encode(["success" => false, "message" => "Could not verify reCAPTCHA. Please try again."]);
    exit;
}

$responseData = json_decode($response, true);

// Check if the token is valid
if (!isset($responseData['tokenProperties']['valid']) || $responseData['tokenProperties']['valid'] !== true) {
    $invalidReason = $responseData['tokenProperties']['invalidReason'] ?? 'unknown';
    error_log("reCAPTCHA invalid token. Reason: $invalidReason");
    echo json_encode(["success" => false, "message" => "reCAPTCHA Invalid Token. Request blocked."]);
    exit;
}

// Check if the action matches
if ($responseData['tokenProperties']['action'] !== $action) {
    echo json_encode(["success" => false, "message" => "reCAPTCHA Action Mismatch."]);
    exit;
}

// Check Score
$score = $responseData['riskAnalysis']['score'] ?? 0;
if ($score < 0.3) {
    echo json_encode(["success" => false, "message" => "Bot detected (Score: $score)."]);
    exit;
}

// 2. Input Sanitization
$name = filter_var(trim($_POST["name"] ?? ""), FILTER_SANITIZE_STRING);
$email = filter_var(trim($_POST["email"] ?? ""), FILTER_SANITIZE_EMAIL);
$message_body = filter_var(trim($_POST["message"] ?? ""), FILTER_SANITIZE_STRING);
$subject_context = filter_var(trim($_POST["subject"] ?? ""), FILTER_SANITIZE_STRING);

// 3. Validation
if (empty($name) || empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL) || empty($message_body)) {
    echo json_encode(["success" => false, "message" => "Please fill in all required fields correctly."]);
    exit;
}

// 4. Construct Email
$email_subject = $subject_context ?: "New Contact from Arabic OCR Website";

$email_content = "Name: $name\n";
$email_content .= "Email: $email\n";
$email_content .= "--------------------------------------\n\n";
$email_content .= "Message:\n$message_body\n\n";
$email_content .= "--------------------------------------\n";
$email_content .= "Sent via Contact Form";

// 5. Headers
$headers = "From: Arabic OCR Support <noreply@arabic-ocr.com>\r\n";
$headers .= "Reply-To: $name <$email>\r\n";
$headers .= "X-Mailer: PHP/" . phpversion();

// 6. Send
if (mail($recipient_email, $email_subject, $email_content, $headers)) {
    echo json_encode(["success" => true]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Server error: Unable to send email."]);
}
?>
