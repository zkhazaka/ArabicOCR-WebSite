<?php
// API Keys — this file is blocked from browser access via .htaccess
define('PADDLE_API_KEY', 'pdl_live_apikey_01khkttj1zx3chj1tb7q8yymss_MJQPb92ntxTwsQg799b8X1_AQ3');

// Paddle webhook secret — copy from Paddle Dashboard → Notifications → your endpoint → Secret key
define('PADDLE_WEBHOOK_SECRET', 'YOUR_WEBHOOK_SECRET_HERE');

// Admin token for protected endpoints (create_discount.php)
// Set this to a long random string and keep it secret
define('ADMIN_SECRET', 'YOUR_ADMIN_SECRET_HERE');
?>
