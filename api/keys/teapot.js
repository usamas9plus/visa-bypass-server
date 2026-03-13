module.exports = (req, res) => {
  res.status(418).json({ 
    message: "I am a teapot", 
    version: "2.4-teapot-test",
    timestamp: new Date().toISOString()
  });
};
