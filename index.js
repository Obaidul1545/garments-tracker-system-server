const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.SRTIPE_SECRET);
const app = express();
const port = process.env.PORT || 3000;
const admin = require('firebase-admin');

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const timePart = Date.now().toString().slice(-4);
  const random = Math.floor(100000 + Math.random() * 900000).toString();
  return timePart + random;
}

// Middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // await client.connect();

    const db = client.db('garments_tracker_db');
    const usersCollection = db.collection('users');
    const productsCollection = db.collection('products');
    const ordersCollection = db.collection('orders');
    const trackingsCollection = db.collection('trackings');
    const paymentCollection = db.collection('payments');

    // middle ware
    const logTracking = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        details: status.split('_').join(' '),
        createdAt: new Date(),
      };
      const result = await trackingsCollection.insertOne(log);
      return result;
    };

    const generateOrderId = async () => {
      const lastOrder = await ordersCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      if (lastOrder.length === 0) {
        return 'ORD001';
      }
      const lastId = lastOrder[0].orderId;
      const lastNumber = parseInt(lastId.replace('ORD', ''));
      const newNumber = lastNumber + 1;
      const orderId = 'ORD' + newNumber.toString().padStart(3, '0');
      return orderId;
    };

    // users releted apis
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.accountStatus = 'pending';
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: 'Already user Exists' });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users', async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ error: 'Email missing' });
      }
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    app.get('/manage-users', async (req, res) => {
      try {
        const { search, role } = req.query;
        const query = {};
        if (search) {
          query.$or = [
            { displayName: { $regex: search, $options: 'i' } },
            { role: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
          ];
        }
        if (role && role !== 'all') {
          query.role = role;
        }
        const result = await usersCollection.find(query).toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/users/manager-count', verifyFBToken, async (req, res) => {
      try {
        const result = await usersCollection.countDocuments({
          role: 'manager',
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Failed to get manager count' });
      }
    });

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'user' });
    });

    app.patch('/update-user', verifyFBToken, async (req, res) => {
      try {
        const { email, role, accountStatus } = req.body;

        const updateDoc = {};
        if (role) updateDoc.role = role;
        if (accountStatus) updateDoc.accountStatus = accountStatus;

        const result = await usersCollection.updateOne(
          { email },
          { $set: updateDoc }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // products releted apis
    app.get('/all-products', async (req, res) => {
      try {
        const { search } = req.query;
        const query = {};
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { category: { $regex: search, $options: 'i' } },
          ];
        }
        const result = await productsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/all-products/display', async (req, res) => {
      try {
        const { search, page = 1, limit = 9 } = req.query;
        const query = {};
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { category: { $regex: search, $options: 'i' } },
          ];
        }
        const result = await productsCollection
          .find(query)
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .sort({ createdAt: -1 })
          .toArray();

        const total = await productsCollection.countDocuments(query);

        res.status(200).send({ result, total });
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/product/:id', async (req, res) => {
      try {
        const productId = req.params.id;
        const query = { _id: new ObjectId(productId) };
        const result = await productsCollection.findOne(query);
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/latest-products', async (req, res) => {
      try {
        const query = { showOnHome: true };
        const result = await productsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();
        res.status(200).send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/products-by-email', verifyFBToken, async (req, res) => {
      try {
        const { search } = req.query;
        const query = {};
        const email = req.decoded_email;

        if (email) {
          query.createdByEmail = email;
        }
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { category: { $regex: search, $options: 'i' } },
          ];
        }
        const result = await productsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.post('/add-product', async (req, res) => {
      try {
        const product = req.body;
        const result = await productsCollection.insertOne(product);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Failed to add product' });
      }
    });

    app.patch('/product/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updateInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updateInfo,
        };
        const result = await productsCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.delete('/product/:id', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await productsCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.patch('/products/:id/show-on-home', verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const { showOnHome } = req.body;

      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { showOnHome },
      };

      const result = await productsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // orders releted apis
    app.post('/orders', async (req, res) => {
      try {
        const orderData = req.body;
        const trackingId = generateTrackingId();
        const orderId = await generateOrderId();
        orderData.createdAt = new Date();
        orderData.orderId = orderId;
        orderData.trackingId = trackingId;
        orderData.status = 'pending';
        await logTracking(trackingId, 'Order_Created');
        const result = await ordersCollection.insertOne(orderData);
        res.status(201).send({ result, orderId, trackingId });
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/all-orders', async (req, res) => {
      try {
        const { search, sortByStatus } = req.query;
        const query = {};
        if (search) {
          query.$or = [
            { orderId: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { productTitle: { $regex: search, $options: 'i' } },
            { status: { $regex: search, $options: 'i' } },
          ];
        }
        if (sortByStatus && sortByStatus !== 'all') {
          query.status = sortByStatus;
        }
        const result = await ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/order/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const result = await ordersCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/orders-by-email', verifyFBToken, async (req, res) => {
      try {
        const { email, search, sortByStatus } = req.query;
        const query = {};
        if (email) {
          query.email = email;
        }
        if (search) {
          query.$or = [
            { orderId: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { productTitle: { $regex: search, $options: 'i' } },
            { status: { $regex: search, $options: 'i' } },
          ];
        }

        if (sortByStatus && sortByStatus !== 'all') {
          query.status = sortByStatus;
        }

        const result = await ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    // pending orders
    app.get('/orders/pending', verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const pendingProducts = await productsCollection
          .find({ createdByEmail: email })
          .project({ _id: 1 })
          .toArray();

        const productId = pendingProducts.map((p) => p._id.toString());
        const query = {
          status: 'pending',
          productId: { $in: productId },
        };
        const result = await ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).send(result);
      } catch (err) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.patch('/orders/:id/approved', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const order = await ordersCollection.findOne({
          _id: new ObjectId(id),
        });
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: 'Approved',
            approvedAt: new Date(),
          },
        };
        await logTracking(order.trackingId, 'Order_Approved');
        const result = await ordersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.patch('/orders/:id/reject', verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const order = await ordersCollection.findOne({
          _id: new ObjectId(id),
        });
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: 'Rejected',
          },
        };
        await logTracking(order.trackingId, 'Order_Rejected');

        const result = await ordersCollection.updateOne(query, updateDoc);

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    // appproved orders
    app.get('/orders/approved', verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;

        const approvedProducts = await productsCollection
          .find({ createdByEmail: email })
          .project({ _id: 1 })
          .toArray();

        const productId = approvedProducts.map((p) => p._id.toString());
        const query = {
          status: 'Approved',
          productId: { $in: productId },
        };
        const result = await ordersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).send(result);
      } catch (err) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    // buyer cancel releted api
    app.patch('/orders/cancel/:id', verifyFBToken, async (req, res) => {
      try {
        const { id } = req.params;
        const order = await ordersCollection.findOne({ _id: new ObjectId(id) });

        if (order.status !== 'pending') {
          return res
            .status(400)
            .send({ message: 'Only pending orders can be cancelled' });
        }
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: 'Cancelled',
            cancelledAt: new Date(),
          },
        };
        const result = await ordersCollection.updateOne(query, updateDoc);
        await logTracking(order.trackingId, 'Order_Cancelled');
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    // tracking releted
    app.post('/add-tracking', verifyFBToken, async (req, res) => {
      try {
        const { trackingId, status, location, note } = req.body;

        const alreadyExists = await trackingsCollection.findOne({
          trackingId,
          status,
        });

        if (alreadyExists) {
          return res.status(409).send({
            message: `Tracking status "${status}" already added`,
          });
        }

        const log = {
          trackingId,
          status,
          location,
          note,
          details: status.split('_').join(' '),
          createdAt: new Date(),
        };

        const result = await trackingsCollection.insertOne(log);

        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    // tracking by trackingId
    app.get('/tracking/:trackingId', verifyFBToken, async (req, res) => {
      try {
        const { trackingId } = req.params;
        const query = { trackingId };
        const result = await trackingsCollection
          .find(query)
          .sort({ createdAt: 1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    //  payment releted api
    app.post('/create-checkout-session', async (req, res) => {
      try {
        const paymentInfo = req.body;
        const amount = parseInt(paymentInfo.totalPrice) * 100;
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: amount,
                product_data: {
                  name: paymentInfo.title,
                },
              },
              quantity: 1,
            },
          ],

          customer_email: paymentInfo.email,
          mode: 'payment',

          metadata: {
            orderId: paymentInfo.orderId,
            productId: paymentInfo.productId,
            trackingId: paymentInfo.trackingId,
          },

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?success=true&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        res.status(500).send({ message: 'Stripe error', error });
      }
    });

    app.patch('/payment-success', async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;
        const existingPayment = await paymentCollection.findOne({
          transactionId,
        });
        if (existingPayment) {
          return res.send({
            message: 'Payment already exists',
            transactionId,
            trackingId: existingPayment.trackingId,
          });
        }
        const trackingId = session.metadata.trackingId;

        if (session.payment_status === 'paid') {
          const orderId = session.metadata.orderId;

          const query = { orderId: orderId };
          const update = {
            $set: {
              paymentStatus: 'Paid',
            },
          };
          const updatedOrder = await ordersCollection.updateOne(query, update);

          const paymentDoc = {
            amount: session.amount_total / 100,
            currency: session.currency,
            BuyerEmail: session.customer_email,
            orderId: session.metadata.orderId,
            productId: session.metadata.productId,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
          };

          const savedPayment = await paymentCollection.insertOne(paymentDoc);

          logTracking(trackingId, 'Order_Paid');

          return res.send({
            success: true,
            updatedOrder,
            transactionId,
            trackingId,
            payment: savedPayment,
          });
        }

        return res.send({ success: false });
      } catch (error) {
        res.status(500).send({ message: 'Payment processing error', error });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
    // console.log(
    //   'Pinged your deployment. You successfully connected to MongoDB!'
    // );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Garments Tracker is Running');
});

app.listen(port, () => {
  console.log(`Garments tracker app listening on port ${port}`);
});
