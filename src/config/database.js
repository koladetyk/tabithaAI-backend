const { Pool } = require('pg');
require('dotenv').config();

console.log('All environment variables:', Object.keys(process.env));
console.log('DATABASE_URL present?', !!process.env.DATABASE_URL);

let pool;

// If DATABASE_URL is provided (Railway), use it
if (process.env.DATABASE_URL) {
  console.log('Using DATABASE_URL connection string');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for Railway's SSL configuration
    }
  });
} else {
  // Otherwise use individual parameters (local development)
  console.log('Using individual parameters for database connection');
  pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'tabitha_db',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
  });
}

module.exports = {
  query: (text, params) => pool.query(text, params),
};