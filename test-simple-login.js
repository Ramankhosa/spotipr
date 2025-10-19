const axios = require('axios')

async function testLogin() {
  console.log('🧪 Testing login...')

  try {
    const response = await axios.post('http://localhost:3000/api/user/login', {
      email: 'analyst@spotipr.com',
      password: 'password123'
    })

    console.log('✅ Login successful')
    console.log('📊 Response:', response.data)

  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message)
  }
}

testLogin()
