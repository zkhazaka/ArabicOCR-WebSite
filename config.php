<?php
// API Keys — this file is blocked from browser access via .htaccess
// PADDLE_API_KEY is now stored as a Cloudflare Worker secret (env.PADDLE_API_KEY)
// To set it: wrangler secret put PADDLE_API_KEY
define('PADDLE_API_KEY', getenv('PADDLE_API_KEY') ?: '');

// Paddle webhook secret — copy from Paddle Dashboard → Notifications → your endpoint → Secret key
define('PADDLE_WEBHOOK_SECRET', 'YOUR_WEBHOOK_SECRET_HERE');

// Admin token for protected endpoints (create_discount.php)
// Set this to a long random string and keep it secret
define('ADMIN_SECRET', 'YOUR_ADMIN_SECRET_HERE');
?>
