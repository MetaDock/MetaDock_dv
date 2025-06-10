// Admin login
async function adminLogin(username, password) {
  try {
    console.log('Attempting admin login...');
    const response = await fetch('/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    console.log('Login response status:', response.status);
    const data = await response.json();
    console.log('Login response data:', data);

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    if (data.success) {
      console.log('Login successful');
      return true;
    } else {
      console.log('Login failed:', data.error);
      return false;
    }
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
} 