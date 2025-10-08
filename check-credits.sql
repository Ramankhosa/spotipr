SELECT u.email, c."totalCredits", c."usedCredits", c."planTier"
FROM users u
LEFT JOIN user_credits c ON u.id = c."userId"
WHERE u.email = 'analyst@spotipr.com';
