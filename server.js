const express = require('express');
const { Pool } = require('pg');
const cors = require('cors'); // Add cors

const app = express();

// Database configuration directly in the file
const pool = new Pool({
  user: 'postgres',          // Replace with your PostgreSQL username
  host: 'localhost',
  database: 'nikufam',  // Replace with your database name
  password: '1234',      // Replace with your PostgreSQL password
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
    process.exit(1); // Exit the process if database connection fails
  }
}

// Test database connection when starting the server
testDatabaseConnection();

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

// API 1: Lấy tất cả bài viết
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Lỗi khi lấy bài viết:', err);
    res.status(500).json({ error: 'Không thể lấy danh sách bài viết' });
  }
});

// API 2: Thêm bài viết mới
app.post('/api/posts', async (req, res) => {
  const { title, content, status } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!title || !content) {
    return res.status(400).json({ error: 'Tiêu đề và nội dung là bắt buộc' });
  }

  // Tạo slug từ tiêu đề
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
    if (err.code === '23505') { // Lỗi trùng slug
      res.status(400).json({ error: 'Slug đã tồn tại, hãy chọn tiêu đề khác' });
    } else {
      res.status(500).json({ error: 'Không thể thêm bài viết' });
    }
  }
});

// API 3: Chỉnh sửa bài viết
app.put('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { title, content, status } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!title || !content) {
    return res.status(400).json({ error: 'Tiêu đề và nội dung là bắt buộc' });
  }

  // Tạo slug từ tiêu đề
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
    if (err.code === '23505') { // Lỗi trùng slug
      res.status(400).json({ error: 'Slug đã tồn tại, hãy chọn tiêu đề khác' });
    } else {
      res.status(500).json({ error: 'Không thể chỉnh sửa bài viết' });
    }
  }
});

// API 4: Xóa bài viết
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

app.post('/api/verify-password', async (req, res) => {
  const { username, password, deviceId } = req.body;

  try {
    // Query the user from the database
    const result = await pool.query(
      'SELECT password, device_id FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const storedPassword = result.rows[0].password;
    const storedDeviceId = result.rows[0].device_id;

    // So sánh thẳng mật khẩu và device ID
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
app.listen(PORT, () => {
  console.log(`Server đang chạy trên port ${PORT}`);
});