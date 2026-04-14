const fs = require('fs');
const path = require('path');

// Load the product data
const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'products-flat-list.json'), 'utf8'));

// Define the hierarchy of keys
const hierarchyOrder = ['Kategori_Product', 'Sub_Kategori_Product', 'Sub_2_Kategori_Product'];

// Build the hierarchical data structure
const treeData = {};
products.forEach(product => {
  let currentLevel = treeData;
  hierarchyOrder.forEach(key => {
    const value = product[key] || 'N/A';
    if (!currentLevel[value]) {
      currentLevel[value] = {};
    }
    currentLevel = currentLevel[value];
  });

  // Add the product name at the leaf
  if (!currentLevel._products) {
    currentLevel._products = [];
  }
  currentLevel._products.push(product.Product_Name);
});

// Function to print the tree structure to the console
function printTree(node, prefix = '', isLast = true) {
  const keys = Object.keys(node).filter(k => k !== '_products');
  keys.forEach((key, index) => {
    const isCurrentLast = index === keys.length - 1 && (!node._products || node._products.length === 0);
    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    console.log(prefix + (isLast ? '└── ' : '├── ') + key);
    if (typeof node[key] === 'object' && node[key] !== null) {
      printTree(node[key], newPrefix, isCurrentLast);
    }
  });

  if (node._products && node._products.length > 0) {
    const productName = node._products[0]; // Show only the first product
    const isProductLast = true;
    console.log(prefix + (isLast ? '    ' : '│   ') + (isProductLast ? '└── ' : '├── ') + `\x1b[34m${productName}\x1b[0m`);
  }
}


// Start printing the tree from the root
console.log('Products');
printTree(treeData);