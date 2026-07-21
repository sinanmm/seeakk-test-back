const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function testUpload() {
  try {
    console.log('1. Image Selected (simulated)');
    const dummyImagePath = path.join(__dirname, 'dummy.webp');
    fs.writeFileSync(dummyImagePath, 'dummy content');
    
    // First login to get a token
    const loginRes = await axios.post('http://localhost:5001/api/auth/login', {
      email: 'harshadmt2001@gmail.com', // from the screenshot
      password: 'password123' // assuming default or we can just bypass auth for the test by fetching a user ID directly from DB
    });
    // Actually, let's just query a user and mock the auth or use a known token.
  } catch (err) {
    console.error(err.message);
  }
}
testUpload();
