// utils/config.js
require('dotenv').config();

module.exports = {
  PORT: Number(process.env.PORT || 8080),
  RATE_LIMIT_PER_MINUTE: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  STRICT_VALIDATE: String(process.env.STRICT_VALIDATE || 'false').toLowerCase() === 'true', // HEAD check
  BITLY_ACCESS_TOKEN: process.env.BITLY_ACCESS_TOKEN || '',
};
