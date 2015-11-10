module.exports = {
  client: 'redis', // Uses sand-redis by default
  path: '/public',
  cache: {
    maxAge: 2592000 // 30 Days (in seconds)
  },
  minified: {
    enabled: true,
    force: false,
    js: {
      enabled: true
    },
    css: {
      enabled: true
    }
  }
};