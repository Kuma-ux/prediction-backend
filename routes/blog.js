const express = require("express");
const router = express.Router();

const {
    createBlog,
    getBlogs
} = require("../controllers/blogController");

const authenticate =
    require("../middleware/authMiddleware");

router.post(
    "/admin/blog/create",
    authenticate,
    createBlog
);

router.get(
    "/blog",
    getBlogs
);

module.exports = router;
