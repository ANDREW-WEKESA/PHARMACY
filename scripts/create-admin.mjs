// Create admin account on production
const PROD_URL = 'https://pharmacy-standalone.andrewwekesa675.workers.dev';

async function createAdmin() {
  console.log('🔐 Creating admin account on production...\n');
  
  const adminData = {
    pharmacy_name: 'My Pharmacy',
    owner_name: 'Pharmacy Admin',
    owner_email: 'admin@pharmacy.com',
    password: 'SecurePassword2026!'
  };

  try {
    const response = await fetch(`${PROD_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adminData)
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Admin account created successfully!\n');
      console.log('📧 Email:', adminData.owner_email);
      console.log('🔑 Password:', adminData.password);
      console.log('\n🌐 Production URL:', PROD_URL);
      console.log('🔐 Auth Token:', data.token);
      console.log('\n⚠️  IMPORTANT: Change your password after first login!');
    } else {
      console.error('❌ Error:', data.error);
      if (data.error && data.error.includes('already exists')) {
        console.log('\n✅ Admin account already exists. Use these credentials to login:');
        console.log('📧 Email:', adminData.owner_email);
        console.log('🔑 Password:', adminData.password);
        console.log('🌐 URL:', PROD_URL);
      }
    }
  } catch (error) {
    console.error('❌ Failed to create admin:', error.message);
  }
}

createAdmin();
