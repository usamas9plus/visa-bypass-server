module.exports = (req, res) => {
  res.status(200).json({ status: 'ok', version: '1.0.6-health-check', time: new Date().toISOString() });
};
