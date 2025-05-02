const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const port = 3000;

// MySQL Connection Pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '227874',
    database: 'library_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Helper function to check if user is logged in
const isLoggedIn = (req, res, next) => {
    if (req.session.loggedIn) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Unauthorized' });
    }
};

// Helper function to check if user is an admin
const isAdmin = (req, res, next) => {
    if (req.session.loggedIn && req.session.isAdmin) {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Forbidden' });
    }
};

// Routes

// Login
app.post('/login', async (req, res) => {
    const { username, password, userType } = req.body;

    try {
        const [rows] = await pool.promise().execute(
            `SELECT id, username, password FROM ${userType === 'admin' ? 'admins' : 'readers'} WHERE username = ?`,
            [username]
        );

        if (rows.length > 0) {
            const user = rows[0];
            const passwordMatch = await bcrypt.compare(password, user.password); // Assuming you'll hash passwords in a real scenario

            if (passwordMatch || password === user.password) { // For demo purposes, allowing plain text for now
                req.session.loggedIn = true;
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.isAdmin = userType === 'admin';

                const redirectPath = userType === 'admin' ? '/admin.html' : `/reader.html?user=${user.username}`;
                res.json({ success: true, redirect: redirectPath });
            } else {
                res.status(401).json({ success: false, message: 'Invalid credentials' });
            }
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            res.status(500).json({ success: false, message: 'Failed to logout' });
        } else {
            res.json({ success: true, redirect: '/login.html' });
        }
    });
});

// Reader Routes
app.get('/api/reader/books', isLoggedIn, async (req, res) => {
    try {
        const [rows] = await pool.promise().execute(`
            SELECT
                b.id,
                b.title,
                b.author,
                b.cover,
                CASE
                    WHEN bb.book_id IS NOT NULL AND bb.return_date IS NULL THEN 'borrowed'
                    ELSE 'available'
                END AS status,
                r.username AS borrowedBy
            FROM books b
            LEFT JOIN borrowed_books bb ON b.id = bb.book_id AND bb.return_date IS NULL
            LEFT JOIN readers r ON bb.reader_id = r.id
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching reader books:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.post('/api/reader/borrow/:bookId', isLoggedIn, async (req, res) => {
    const bookId = req.params.bookId;
    const readerId = req.session.userId;

    try {
        // Check if the book is already borrowed
        const [borrowedCheck] = await pool.promise().execute(
            'SELECT id FROM borrowed_books WHERE book_id = ? AND return_date IS NULL',
            [bookId]
        );

        if (borrowedCheck.length > 0) {
            return res.status(400).json({ success: false, message: 'Book is already borrowed.' });
        }

        // Create a new borrowing record
        await pool.promise().execute(
            'INSERT INTO borrowed_books (book_id, reader_id, borrow_date) VALUES (?, ?, NOW())',
            [bookId, readerId]
        );

        res.json({ success: true, message: 'Book borrowed successfully.' });
    } catch (error) {
        console.error('Error borrowing book:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.post('/api/reader/return/:bookId', isLoggedIn, async (req, res) => {
    const bookId = req.params.bookId;
    const readerId = req.session.userId;

    try {
        const [borrowedBook] = await pool.promise().execute(
            'SELECT id FROM borrowed_books WHERE book_id = ? AND reader_id = ? AND return_date IS NULL',
            [bookId, readerId]
        );

        if (borrowedBook.length === 0) {
            return res.status(400).json({ success: false, message: 'You have not borrowed this book.' });
        }

        await pool.promise().execute(
            'UPDATE borrowed_books SET return_date = NOW() WHERE id = ?',
            [borrowedBook[0].id]
        );

        res.json({ success: true, message: 'Book returned successfully.' });
    } catch (error) {
        console.error('Error returning book:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.post('/api/reader/purchase/:bookId', isLoggedIn, async (req, res) => {
    const bookId = req.params.bookId;
    const readerId = req.session.userId;

    try {
        // In a real scenario, you'd handle payment processing 
        await pool.promise().execute(
            'INSERT INTO purchased_books (book_id, reader_id, purchase_date) VALUES (?, ?, NOW())',
            [bookId, readerId]
        );

        res.json({ success: true, message: 'Book purchased successfully.' });
    } catch (error) {
        console.error('Error purchasing book:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Admin Routes
app.get('/api/books', isAdmin, async (req, res) => {
    try {
        const [rows] = await pool.promise().execute(`
            SELECT
                b.id,
                b.title,
                b.author,
                b.cover,
                CASE
                    WHEN bb.book_id IS NOT NULL AND bb.return_date IS NULL THEN 'borrowed'
                    ELSE 'available'
                END AS status,
                r.username AS borrowedBy
            FROM books b
            LEFT JOIN borrowed_books bb ON b.id = bb.book_id AND bb.return_date IS NULL
            LEFT JOIN readers r ON bb.reader_id = r.id
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching books for admin:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.post('/api/books', isAdmin, async (req, res) => {
    const { title, author, cover } = req.body;
    try {
        const [result] = await pool.promise().execute(
            'INSERT INTO books (title, author, cover, created_at) VALUES (?, ?, ?, NOW())',
            [title, author, cover]
        );
        const [newBook] = await pool.promise().execute('SELECT * FROM books WHERE id = ?', [result.insertId]);
        res.status(201).json(newBook[0]);
    } catch (error) {
        console.error('Error adding book:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.put('/api/books/:id', isAdmin, async (req, res) => {
    const bookId = req.params.id;
    const { title, author, cover } = req.body;
    try {
        await pool.promise().execute(
            'UPDATE books SET title = ?, author = ?, cover = ? WHERE id = ?',
            [title, author, cover, bookId]
        );
        const [updatedBook] = await pool.promise().execute('SELECT * FROM books WHERE id = ?', [bookId]);
        if (updatedBook.length > 0) {
            res.json(updatedBook[0]);
        } else {
            res.status(404).json({ success: false, message: 'Book not found' });
        }
    } catch (error) {
        console.error('Error updating book:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.delete('/api/books/:id', isAdmin, async (req, res) => {
    const bookId = req.params.id;
    try {
        await pool.promise().execute('DELETE FROM books WHERE id = ?', [bookId]);
        res.sendStatus(204);
    } catch (error) {
        console.error('Error deleting book:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.get('/api/admin/borrowed', isAdmin, async (req, res) => {
    try {
        const [rows] = await pool.promise().execute(`
            SELECT
                bb.book_id,
                b.title,
                r.username AS borrowedBy,
                bb.borrow_date
            FROM borrowed_books bb
            JOIN books b ON bb.book_id = b.id
            JOIN readers r ON bb.reader_id = r.id
            WHERE bb.return_date IS NULL
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching borrowed books:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});