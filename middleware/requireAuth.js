const jwt = require("jsonwebtoken");

module.exports = function requireAuth(
  req,
  res,
  next
) {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.user = {
      id: decoded.userId,
      role: decoded.role,
    };

    next();

  } catch (err) {

    return res.status(401).json({
      success: false,
      error: "Invalid token",
    });
  }
};