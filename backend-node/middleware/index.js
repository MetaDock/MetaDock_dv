/**
 * Shared middleware: connection check, session, logging.
 * Multer is configured in server.js (needs appConfig.paths.tempUploads).
 */

function checkConnection(req, res, next) {
  if (!req.app.locals.connectionDetails) {
    return res.redirect('/login');
  }
  next();
}

function checkConnectionAPI(req, res, next) {
  if (!req.app.locals.connectionDetails) {
    return res.status(401).json({
      error: 'No connection established',
      message: 'Please establish server connection first'
    });
  }
  next();
}

function requestLogger(req, res, next) {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
}

module.exports = {
  checkConnection,
  checkConnectionAPI,
  requestLogger
};
