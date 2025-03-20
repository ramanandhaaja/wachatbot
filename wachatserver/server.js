const app = require('./src/app');
const config = require('./src/config/config');

app.listen(config.port, () => {
  console.log(`WhatsApp Server is running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.env}`);
});
