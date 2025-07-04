const { Pool } = require('pg');
require('dotenv').config();

console.log('All environment variables:', Object.keys(process.env));
console.log('DATABASE_URL present?', !!process.env.DATABASE_URL);
console.log('DATABASE_URL value:', process.env.DATABASE_URL);

let pool;

if (process.env.DATABASE_URL) {
  console.log('Using DATABASE_URL connection string');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  console.log('Using individual parameters for database connection');
  pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'tabitha_db',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
  });
}

// Export the actual pool so we can call pool.connect()
module.exports = pool;
