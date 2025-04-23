const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const redis = require('redis');

const app = express();

// Initialize Redis client with reconnection strategy
const client = redis.createClient({
  url: 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Max retries reached, giving up on reconnecting');
        return new Error('Max retries reached');
      }
      return Math.min(retries * 100, 3000);
    },
  },
});

// Log Redis events
client.on('error', (err) => console.error('Redis Client Error:', err));
client.on('connect', () => console.log('Connected to Redis'));
client.on('reconnecting', () => console.log('Reconnecting to Redis...'));

// Connect to Redis
async function connectRedis() {
  try {
    await client.connect();
    console.log('Redis client connected successfully');
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
    process.exit(1);
  }
}

// Database configuration
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'nikufam',
  password: '1234',
  port: 5432,
});

// Middleware
app.use(express.json());
app.use(cors());

// Function to test database connection
async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('Đã kết nối thành công đến database!');
  } catch (err) {
    console.error('Lỗi kết nối đến database:', err);
    process.exit(1);
  }
}

// Start server with DB and Redis connections
async function startServer() {
  await testDatabaseConnection();
  await connectRedis();
  app.listen(PORT, () => {
    console.log(`Server đang chạy trên port ${PORT}`);
  });
}

// Test database connection endpoint
app.get('/api/test', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Database connection failed' });
  }
});

// Reading all posts
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Lỗi khi lấy bài viết:', err);
    res.status(500).json({ error: 'Không thể lấy danh sách bài viết' });
  }
});

// Adding new posts
app.post('/api/posts', async (req, res) => {
  const { title, content, status } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Tiêu đề và nội dung là bắt buộc' });
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  try {
    const query = `
      INSERT INTO posts (title, content, status, slug)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const values = [title, content, status || 'draft', slug];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Lỗi khi thêm bài viết:', err);
    if (err.code === '23505') {
      res.status(400).json({ error: 'Slug đã tồn tại, hãy chọn tiêu đề khác' });
    } else {
      res.status(500).json({ error: 'Không thể thêm bài viết' });
    }
  }
});

// Modifying posts
app.put('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { title, content, status } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Tiêu đề và nội dung là bắt buộc' });
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  try {
    const query = `
      UPDATE posts
      SET title = $1, content = $2, status = $3, slug = $4
      WHERE id = $5
      RETURNING *;
    `;
    const values = [title, content, status || 'draft', slug, id];
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Bài viết không tồn tại' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Lỗi khi chỉnh sửa bài viết:', err);
    if (err.code === '23505') {
      res.status(400).json({ error: 'Slug đã tồn tại, hãy chọn tiêu đề khác' });
    } else {
      res.status(500).json({ error: 'Không thể chỉnh sửa bài viết' });
    }
  }
});

// Deleting posts
app.delete('/api/posts/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const query = 'DELETE FROM posts WHERE id = $1 RETURNING *;';
    const result = await pool.query(query, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Bài viết không tồn tại' });
    }

    res.json({ message: 'Xóa bài viết thành công' });
  } catch (err) {
    console.error('Lỗi khi xóa bài viết:', err);
    res.status(500).json({ error: 'Không thể xóa bài viết' });
  }
});

// Check username
app.post('/api/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0) {
      res.status(200).json({ exists: true });
    } else {
      res.status(404).json({ exists: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Store access code
app.post('/store-access-code', async (req, res) => {
  const { accessCode, username } = req.body;
  if (!accessCode || !username) {
    return res.status(400).json({ error: 'Access code and username are required' });
  }
  try {
    // Store access code with username in the key to ensure uniqueness
    const redisKey = `accessCode:${username}:${accessCode}`;
    await client.setEx(redisKey, 300, 'valid'); // Expires in 5 minutes
    res.json({ success: true });
  } catch (error) {
    console.error('Error storing access code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify access code
app.post('/verify-access-code', async (req, res) => {
  const { accessCode, username } = req.body;
  if (!accessCode || !username) {
    return res.status(400).json({ error: 'Access code and username are required' });
  }
  try {
    const redisKey = `accessCode:${username}:${accessCode}`;
    const reply = await client.get(redisKey);
    if (reply === 'valid') {
      await client.del(redisKey); // Delete after verification
      return res.json({ success: true });
    }
    res.status(401).json({ error: 'Invalid or expired access code' });
  } catch (error) {
    console.error('Error verifying access code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify password
app.post('/api/verify-password', async (req, res) => {
  const { username, password, deviceId } = req.body;

  try {
    const result = await pool.query(
      'SELECT password, device_id FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const storedPassword = result.rows[0].password;
    const storedDeviceId = result.rows[0].device_id;

    if (password === storedPassword && deviceId === storedDeviceId) {
      return res.status(200).json({ success: true, message: 'Password verified successfully' });
    } else {
      return res.status(401).json({ error: 'Invalid password or device ID' });
    }
  } catch (error) {
    console.error('Error verifying password:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
startServer();