const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// ================= SECURITY =================
app.use(helmet());

app.use(cors({
    origin: [
        "https://nutribliss-frontend.pages.dev", // 🔁 replace this
        "http://localhost:3000"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

// ================= RATE LIMIT =================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use(limiter);

// Extra protection for orders
const orderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20
});

// ================= MODELS =================
const Product = require("./models/Products");
const Order = require("./models/order");

// ================= MONGODB =================
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB Atlas connected ✅"))
.catch(() => {
    console.error("DB error ❌");
    process.exit(1);
});

// ================= RAZORPAY =================
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ================= ADMIN LOGIN =================
app.post("/admin-login", (req, res) => {
    const { username, password } = req.body;

    if (
        username?.trim() === process.env.ADMIN_USERNAME &&
        password?.trim() === process.env.ADMIN_PASSWORD
    ) {
        const token = jwt.sign(
            { role: "admin" },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        return res.json({ success: true, token });
    }

    res.status(401).json({ success: false });
});

// ================= AUTH =================
function verifyAdmin(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== "admin") return res.sendStatus(403);
        next();
    } catch {
        return res.sendStatus(401);
    }
}

// ================= PRODUCTS =================
app.get("/products", async (req, res) => {
    try {
        const data = await Product.find();
        res.json(data);
    } catch {
        res.status(500).json({ error: "Failed" });
    }
});

app.post("/products", verifyAdmin, async (req, res) => {
    try {
        const { name, price, image, category, stock } = req.body;

        if (!name || !price) {
            return res.status(400).json({ error: "Invalid data" });
        }

        await Product.create({
            name,
            price: Number(price),
            image: image || "",
            category: category || "Mixed",
            stock: Number(stock) || 10
        });

        res.json({ message: "Added" });
    } catch {
        res.status(500).json({ error: "Failed" });
    }
});

app.put("/products/:id", verifyAdmin, async (req, res) => {
    try {
        const { name, price, image, category, stock } = req.body;

        await Product.findByIdAndUpdate(req.params.id, {
            name,
            price: Number(price),
            image,
            category,
            stock: Number(stock)
        });

        res.json({ message: "Updated" });
    } catch {
        res.status(500).json({ error: "Failed" });
    }
});

app.delete("/products/:id", verifyAdmin, async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: "Deleted" });
    } catch {
        res.status(500).json({ error: "Failed" });
    }
});

// ================= PAYMENT =================
app.post("/create-order", async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
        }

        const order = await razorpay.orders.create({
            amount: amount * 100,
            currency: "INR",
            receipt: "rcpt_" + Date.now()
        });

        res.json(order);
    } catch {
        res.status(500).json({ error: "Payment failed" });
    }
});

// ================= SAVE ORDER =================
app.post("/save-order", orderLimiter, async (req, res) => {
    try {
        const { name, address, phone, cart, total, paymentId } = req.body;

        // CUSTOMER VALIDATION
        if (!name || !address || !phone) {
            return res.status(400).json({ error: "Invalid details" });
        }

        if (!/^[6-9]\d{9}$/.test(phone)) {
            return res.status(400).json({ error: "Invalid phone" });
        }

        // CART VALIDATION
        if (!Array.isArray(cart) || cart.length === 0) {
            return res.status(400).json({ error: "Invalid cart" });
        }

        let serverTotal = 0;

        for (const item of cart) {
            const product = await Product.findById(item.id);

            if (!product) return res.status(404).json({ error: "Not found" });

            if (product.stock < item.quantity) {
                return res.status(400).json({ error: "Stock low" });
            }

            serverTotal += product.price * item.quantity;
        }

        const finalTotal = paymentId === "COD"
            ? serverTotal + 30
            : serverTotal;

        if (Number(total) !== finalTotal) {
            return res.status(400).json({ error: "Price mismatch" });
        }

        const order = await Order.create({
            name,
            address,
            phone,
            items: cart,
            total: finalTotal,
            paymentId,
            status: "Pending",
            date: new Date()
        });

        // REDUCE STOCK
        for (const item of cart) {
            await Product.findByIdAndUpdate(item.id, {
                $inc: { stock: -item.quantity }
            });
        }

        res.json({ message: "Order placed" });

    } catch {
        res.status(500).json({ error: "Failed" });
    }
});

// ================= ORDERS =================
app.get("/orders", verifyAdmin, async (req, res) => {
    const data = await Order.find().sort({ date: -1 });
    res.json(data);
});

app.get("/track-order/:phone", async (req, res) => {
    const data = await Order.find({ phone: req.params.phone });
    if (!data.length) return res.status(404).json({ message: "No orders" });
    res.json(data);
});

app.put("/orders/:id", verifyAdmin, async (req, res) => {
    const { status } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ error: "Not found" });

    if (order.status !== "Cancelled" && status === "Cancelled") {
        for (const item of order.items) {
            await Product.findByIdAndUpdate(item.id, {
                $inc: { stock: item.quantity }
            });
        }
    }

    order.status = status;
    await order.save();

    res.json({ message: "Updated" });
});

// ================= SERVER =================
app.listen(process.env.PORT || 3000, () => {
    console.log("Server running 🚀");
});