const express = require('express');
const path = require('path');

const app = express();
const port = 3000;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Route for the root to serve product-tree.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'product-tree.html'));
});

app.get('/api/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'products-flat-list.json'));
});

app.get('/api/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'products-flat-list.json'));
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
