/**
 * Page routes: /, /login, /dashboard, /theme-test, /test-agent
 */
function registerPageRoutes(app, toolsConfig, checkConnection) {
  function safeRender(res, view, model) {
    res.render(view, model, (err, html) => {
      if (err) return res.status(404).send(`View "${view}" is not available in this build.`);
      return res.send(html);
    });
  }

  app.get('/', (req, res) => res.redirect('/login'));

  app.get('/login', (req, res) => {
    if (req.session.isAdmin) return res.redirect('/admin');
    res.render('login');
  });

  app.get('/dashboard', checkConnection, (req, res) => {
    if (req.session.isAdmin) return res.redirect('/admin');
    res.render('dashboard', { toolsConfig });
  });

  app.get('/theme-test', (req, res) => {
    safeRender(res, 'theme-test', {
      title: 'Theme Toggle Test - MetaDock',
      connectionDetails: req.session.connectionDetails,
      isAdmin: req.session.isAdmin
    });
  });

  app.get('/test-agent', (req, res) => {
    safeRender(res, 'test-agent-widget', { title: 'Agent Widget Test - MetaDock' });
  });
}

module.exports = { registerPageRoutes };
