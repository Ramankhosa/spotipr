SELECT u.email, u.name, u.role, u.status, u."signupAtiTokenId",
       tok."rawToken", tok.status as token_status, tok."planTier"
FROM users u
LEFT JOIN "ati_tokens" tok ON u."signupAtiTokenId" = tok.id
WHERE u.email = 'analyst@spotipr.com';
