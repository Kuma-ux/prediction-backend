const express = require("express");
const router = express.Router();

const {
    createBlog
} = require("../controllers/blogController");

const authenticate =
    require("../middleware/authenticate");

router.post(
    "/admin/blog/create",
    authenticate,
    createBlog
);

module.exports = router;
