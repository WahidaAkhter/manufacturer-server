const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


const uri =`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.m31bg.mongodb.net/?retryWrites=true&w=majority`;


const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).send({ message: 'UnAuthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
      if (err) {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      req.decoded = decoded;
      next();
    });
  }


async function run(){
    try{
        await client.connect();
        const serviceCollection = client.db('warbitor').collection('services');
        const userCollection = client.db('warbitor').collection('users');
        const purchaseModalCollection = client.db('warbitor').collection('purchaseModals');
        const paymentCollection = client.db('warbitor').collection('payments');

        app.post('/create-payment-intent', verifyJWT, async(req, res) =>{
          const service = req.body;
          const price = service.price;
          const amount = price*100;
          const paymentIntent = await stripe.paymentIntents.create({
            amount : amount,
            currency: 'usd',
            payment_method_types:['card']
          });
          res.send({clientSecret: paymentIntent.client_secret})
        });

        app.get('/service', async(_req, res) =>{
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        })

        app.get('/available', async(req, res) =>{
          const date = req.query.date;

          const services = await serviceCollection.find().toArray();
          
          const query = {date: date};
          const purchaseModals = await purchaseModalCollection.find(query).toArray();

          services.forEach(service=>{
            const serviceBookings = purchaseModals.filter(book => book.purchase === service.name);
            const bookedSlots = serviceBookings.map(book => book.slot);
            const available = service.slots.filter(slot => !bookedSlots.includes(slot)); 
            service.slots = available;
          });
          res.send(services); 
        })

        app.get('/user', verifyJWT, async (req, res) => {
          const users = await userCollection.find().toArray();
          res.send(users);
        });

        app.put('/user/admin/:email', verifyJWT, async (req, res) => {
          const email = req.params.email;
          const requester = req.decoded.email;
          const requesterAccount = await userCollection.findOne({ email: requester });
          if (requesterAccount.role === 'admin') {
            const filter = { email: email };
            const updateDoc = {
              $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
          }
          else{
            res.status(403).send({message: 'forbidden'});
          }
    
        });

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
              $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ result, token });
          })

          app.get('/purchaseModal',verifyJWT, async(req, res) =>{
            const customer = req.query.customer;
            const decodedEmail = req.decoded.email;
            if (customer === decodedEmail){
              const query = {customer: customer};
              const purchaseModals = await purchaseModalCollection.find(query).toArray();
              res.send(purchaseModals);
            }
            else {
              return res.status(403).send({ message: 'forbidden access' });
            }
           
          })
          app.get('/purchaseModal/:id', verifyJWT, async(req, res) =>{
            const id = req.params.id;
            const query = {id: ObjectId(id)};
            const purchaseModal = await purchaseModalCollection.findOne(query);
            res.send(purchaseModal);
          })

          app.patch('/purchaseModal/:id', verifyJWT, async(req, res) =>{
            const id  = req.params.id;
            const payment = req.body;
            const filter = {id: ObjectId(id)};
            const updatedDoc = {
              $set: {
                paid: true,
                transactionId: payment.transactionId
              }
            }
      
            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await purchaseModalCollection.updateOne(filter, updatedDoc);
            res.send(updatedBooking);

            
          })
      
          app.post('/purchaseModal', async (req, res) => {
            const purchaseModal = req.body;
            const query = { purchase: purchaseModal.purchase, date: purchaseModal.date, customer: purchaseModal.customer }
            const exists = await purchaseModalCollection.findOne(query);
            if (exists) {
              return res.send({ success: false, purchaseModal: exists })
            }
            const result = await purchaseModalCollection.insertOne(purchaseModal);
            return res.send({ success: true, result });
          })
      
        }

    finally{

    }
}

run().catch(console.dir);


app.get('/', (req, res) => {
  res.send(`Hello From Warbitor!`)
})

app.listen(port, () => {
  console.log(`warbitor on port ${port}`)
})