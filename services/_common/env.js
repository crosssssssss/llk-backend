export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  MYSQL_DSN: process.env.MYSQL_DSN || 'mysql://root:root@127.0.0.1:3306/llk',
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  JWT_SECRET: process.env.JWT_SECRET || 'replace_me',
  PORT: Number(process.env.PORT || 0)
};
