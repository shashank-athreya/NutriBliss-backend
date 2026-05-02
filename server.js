const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const Razorpay = require("razorpay");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// Render / proxy support for rate limiter
app.set("trust proxy", 1);

// ================= SECURITY =================
app.use(helmet());

app.use(cors({
    origin: [
        "https://nutribliss-frontend.pages.dev",
        "http://localhost:3000"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

// ================= RATE LIMITS =================
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Too many requests. Please try again later." }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Too many login attempts. Please try again later." }
});

const orderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "Too many order attempts. Please try again later." }
});

app.use(generalLimiter);

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
app.post("/admin-login", loginLimiter, (req, res) => {
    const { username, password } = req.body;

    const inputUsername = username?.trim();
    const inputPassword = password?.trim();

    const adminUsername = process.env.ADMIN_USERNAME?.trim();
    const adminPassword = process.env.ADMIN_PASSWORD?.trim();

    if (inputUsername === adminUsername && inputPassword === adminPassword) {
        const token = jwt.sign(
            { role: "admin" },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        return res.json({ success: true, token });
    }

    res.status(401).json({
        success: false,
        message: "Invalid admin credentials"
    });
});

// ================= AUTH =================
function verifyAdmin(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "No token provided" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== "admin") {
            return res.status(403).json({ error: "Admin access denied" });
        }

        next();
    } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

// ================= PRODUCTS =================
app.get("/products", async (req, res) => {
    try {
        const data = await Product.find().sort({ name: 1 });
        res.json(data);
    } catch {
        res.status(500).json({ error: "Failed to fetch products" });
    }
});

app.post("/products", verifyAdmin, async (req, res) => {
    try {
        const { name, price, image, category, stock } = req.body;

        if (!name || !price || Number(price) <= 0) {
            return res.status(400).json({ error: "Valid name and price are required" });
        }

        const validCategories = ["Mixed", "Cashew", "Almond", "Pistachio", "Walnut"];
        const finalCategory = validCategories.includes(category) ? category : "Mixed";

        await Product.create({
            name: name.trim(),
            price: Number(price),
            image: image || "https://via.placeholder.com/200",
            category: finalCategory,
            stock: Number(stock) >= 0 ? Number(stock) : 10
        });

        res.json({ message: "Product added successfully" });
    } catch {
        res.status(500).json({ error: "Failed to add product" });
    }
});

app.put("/products/:id", verifyAdmin, async (req, res) => {
    try {
        const { name, price, image, category, stock } = req.body;

        if (!name || !price || Number(price) <= 0) {
            return res.status(400).json({ error: "Valid name and price are required" });
        }

        const validCategories = ["Mixed", "Cashew", "Almond", "Pistachio", "Walnut"];
        const finalCategory = validCategories.includes(category) ? category : "Mixed";

        await Product.findByIdAndUpdate(req.params.id, {
            name: name.trim(),
            price: Number(price),
            image: image || "https://via.placeholder.com/200",
            category: finalCategory,
            stock: Number(stock) >= 0 ? Number(stock) : 0
        });

        res.json({ message: "Product updated successfully" });
    } catch {
        res.status(500).json({ error: "Failed to update product" });
    }
});

app.delete("/products/:id", verifyAdmin, async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: "Product deleted successfully" });
    } catch {
        res.status(500).json({ error: "Failed to delete product" });
    }
});

// ================= PAYMENT =================
app.post("/create-order", orderLimiter, async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({ error: "Valid amount is required" });
        }

        const order = await razorpay.orders.create({
            amount: Number(amount) * 100,
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
        const { name, address, phone, cart, total, paymentId, coupon } = req.body;

        // VALIDATION
        if (!name || !address || !phone) {
            return res.status(400).json({ error: "Invalid details" });
        }

        if (!/^[6-9]\d{9}$/.test(phone)) {
            return res.status(400).json({ error: "Invalid phone" });
        }

        if (!Array.isArray(cart) || cart.length === 0) {
            return res.status(400).json({ error: "Invalid cart" });
        }

        let serverTotal = 0;

        // STOCK CHECK + PRICE CALCULATION
        for (const item of cart) {
            const product = await Product.findById(item.id);

            if (!product) {
                return res.status(404).json({ error: "Product not found" });
            }

            if (product.stock < item.quantity) {
                return res.status(400).json({
                    error: `${product.name} has only ${product.stock} left`
                });
            }

            serverTotal += product.price * item.quantity;
        }

        // DELIVERY
        let deliveryCharge = serverTotal >= 999 ? 0 : 50;

        // COUPON
        let discount = 0;

        if (coupon === "NUTRI10") {
            discount = Math.floor(serverTotal * 0.10);
        }

        if (coupon === "SAVE50") {
            discount = serverTotal >= 50 ? 50 : 0;
        }

        // COD
        let codCharge = paymentId === "COD" ? 30 : 0;

        const finalTotal = serverTotal + deliveryCharge + codCharge - discount;

        // SECURITY CHECK
        if (Number(total) !== finalTotal) {
            return res.status(400).json({ error: "Price mismatch detected" });
        }

        // SAVE ORDER
        const order = await Order.create({
            name,
            address,
            phone,
            items: cart,
            total: finalTotal,
            paymentId,
            coupon: coupon || "",
            status: "Pending",
            date: new Date()
        });

        // REDUCE STOCK
        for (const item of cart) {
            await Product.findByIdAndUpdate(item.id, {
                $inc: { stock: -item.quantity }
            });
        }

        res.json({ message: "Order placed successfully" });

    } catch (err) {
        console.log("Order error:", err);
        res.status(500).json({ error: "Failed to place order" });
    }
});

// ================= ORDERS =================
app.get("/orders", verifyAdmin, async (req, res) => {
    try {
        const data = await Order.find().sort({ date: -1 });
        res.json(data);
    } catch {
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

app.get("/track-order/:phone", async (req, res) => {
    try {
        const phone = req.params.phone;

        if (!/^[6-9]\d{9}$/.test(String(phone))) {
            return res.status(400).json({ message: "Invalid phone number" });
        }

        const data = await Order.find({ phone }).sort({ date: -1 });

        if (!data.length) {
            return res.status(404).json({ message: "No orders found" });
        }

        res.json(data);
    } catch {
        res.status(500).json({ error: "Failed to track order" });
    }
});

app.put("/orders/:id", verifyAdmin, async (req, res) => {
    try {
        const { status, note } = req.body;

        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        const oldStatus = order.status;

        // Restore stock when cancelled
        if (oldStatus !== "Cancelled" && status === "Cancelled") {
            for (const item of order.items) {
                await Product.findByIdAndUpdate(item.id, {
                    $inc: { stock: item.quantity }
                });
            }
        }

        // Reduce stock if reactivated
        if (oldStatus === "Cancelled" && status !== "Cancelled") {
            for (const item of order.items) {
                await Product.findByIdAndUpdate(item.id, {
                    $inc: { stock: -item.quantity }
                });
            }
        }

        order.status = status;
        if (note !== undefined) {
            order.note = note;
        }

        await order.save();

        res.json({ message: "Order updated successfully" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Update failed" });
    }
});

// ================= ROOT =================
app.get("/", (req, res) => {
    res.send("NutriBliss backend is running 🚀");
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});