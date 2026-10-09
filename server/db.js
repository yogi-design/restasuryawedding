import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const user = process.env.MYSQL_USER?.trim();
const database = process.env.MYSQL_DATABASE?.trim();

if (!user || !database) {
  throw new Error('MYSQL_USER and MYSQL_DATABASE must be set in the server environment.');
}

const config = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user,
  password: process.env.MYSQL_PASSWORD || '',
  database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

export const pool = mysql.createPool(config);

export async function pingDb() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
