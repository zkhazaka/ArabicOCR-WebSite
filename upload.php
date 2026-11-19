<?php
header('Access-Control-Allow-Origin: *'); // Or restrict to https://arabic-ocr.com
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// 1. Check if file was uploaded without errors
if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['error' => 'No file uploaded or upload error occurred.']);
    exit;
}

$file = $_FILES['image'];
$allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
$maxFileSize = 5 * 1024 * 1024; // 5 MB

// 2. Validate file type
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if (!in_array($mimeType, $allowedTypes)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid file type. Only JPG, PNG, WEBP, and GIF are allowed.']);
    exit;
}

// 3. Validate file size
if ($file['size'] > $maxFileSize) {
    http_response_code(400);
    echo json_encode(['error' => 'File size exceeds the 5MB limit.']);
    exit;
}

// 4. Create uploads directory if it doesn't exist
$uploadDir = __DIR__ . '/uploads/blog-featured/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

// 5. Generate unique filename and move
$extension = pathinfo($file['name'], PATHINFO_EXTENSION);
// If pathinfo fails to get extension, try to map from mime type
if (empty($extension)) {
    $mimeToExt = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
        'image/gif'  => 'gif'
    ];
    $extension = $mimeToExt[$mimeType] ?? 'jpg';
}

$filename = uniqid('img_', true) . '_' . time() . '.' . strtolower($extension);
$destination = $uploadDir . $filename;

if (move_uploaded_file($file['tmp_name'], $destination)) {
    // Generate public URL
    $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https://' : 'http://';
    $host = $_SERVER['HTTP_HOST'];
    $publicUrl = $protocol . $host . '/uploads/blog-featured/' . $filename;

    echo json_encode([
        'success' => true,
        'url' => $publicUrl
    ]);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save the uploaded file to the server.']);
}
?>
