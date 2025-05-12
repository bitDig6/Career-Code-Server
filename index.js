require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
app.use(cors({
  origin: ['http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());


//custom middlewares
const logger = (req, res, next) => {
  console.log('inside the logger');
  next();
}

const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;  
  //if there's no token
  if(!token){
    return res.status(401).send({message: "Unauthorized Access"});
  }

  jwt.verify(token, process.env.ACCESS_JWT_SECRET, (err, decoded) => {
    //if problem with parsing the token
    //it may happen because of expired or non-existent or incorrect or invalid token
    if(err){
      return res.status(401).send({message: "Could not verify/decode token. Unauthorized access."})
    }
    //req.user = decoded;
    req.decoded = decoded;
  })
  
  next();
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jpi5bfv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    const database = client.db('JobPortal');
    const jobsCollection = database.collection('jobs');
    const jobApplicationsCollection = database.collection('applications');

   //auth related api
   app.post('/jwt', (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.ACCESS_JWT_SECRET, {expiresIn: '10h'});
    res.cookie('token', token, {
      httpOnly: true,
      secure: false
    }).send({success: true});
   })

   app.post('/logout', (req, res) => {
    res.clearCookie('token', {
      httpOnly: true,
      secure: false
    }).send({success: true});
   })

    //jobs related apis
    app.get('/jobs', async (req, res) => {
      console.log('now inside get all jobs api callback')
      const email = req.query.email;
      let query = {};
      if (email) {
        query = { hr_email: email };
      }

      const cursor = jobsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/jobs/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobsCollection.findOne(query);
      res.send(result);
    })

    //get job application data
    //get all data, get one data, get some data (0, 1 or many)
    app.get('/jobApplications', verifyToken, async (req, res) => {
      //query format for url: ?name=value
      const email = req.query.email; //name is email and value is value, this isn't like normal programming that email will be seen by his value
      const query = { application_email: email };

      //checking if the token actually belongs to the user that was requested in the email query
      //it prevents to get others' data even if the token is invalid
      //each token will be only for that specified user, by using a valid token one cannot get another user's data
      //forbidden
      //this can also ensure for example, a normal user can't get access to the resources that an admin can use
      if(req.decoded.email !== email){
        return res.status(403).send({message: "Forbidden Access"});
      }

      //cookie parser automatically sets cookie to all requests from the client side
      // console.log('cookie saved: ', req.cookies);
      //console.log('token', req.cookies.token);

      //I might get multiple value so must use find() and then use await and toArray
      const cursor = jobApplicationsCollection.find(query);
      const result = await cursor.toArray();

      // res.send(result);
      //let's not get all the information in each data of the query
      // a poor approach to do this
      for (application of result) {
        const id = application.job_id;
        const query = { _id: new ObjectId(id) };
        const result2 = await jobsCollection.findOne(query);
        application.company = result2.company;
        application.jobType = result2.jobType;
        application.category = result2.category;
        application.location = result2.location;
      }
      res.send(result);
    })

    //we're using this url to indicate that we need a particular job with that id from all the job applications
    //this is for the recruiter to see all the applications for a particular job that is posted by them
    //here we are bringing the applications not the job dude!
    app.get('/jobApplications/jobs/:job_id', async (req, res) => {
      //we will search with job_id, not _id
      const jobId = req.params.job_id;
      const query = { job_id: jobId };
      const cursor = jobApplicationsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    app.post('/jobApplications', async (req, res) => {
      const application = req.body;
      const result = await jobApplicationsCollection.insertOne(application);

      //very poor approach way to send the applications count data

      const id = application.job_id;
      const query = { _id: new ObjectId(id) };
      const job = await jobsCollection.findOne(query);
      let newCount = 0;
      if (job.applicationCount) {
        newCount = job.applicationCount + 1;
      } else {
        newCount = 1;
      }

      //now update the job info
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          applicationCount: newCount
        }
      }
      const updatedResult = await jobsCollection.updateOne(filter, updatedDoc);

      res.send(result);
    })

    app.post('/jobs', async (req, res) => {
      const newJob = req.body;
      const result = await jobsCollection.insertOne(newJob);
      res.send(result);
    })

    app.delete('/jobApplications/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobApplicationsCollection.deleteOne(query);
      res.send(result);
    })

    app.patch('/jobApplications/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const data = req.body;
      const updatedDoc = {
        $set: {
          status: data.status
        }
      };
      const result = await jobApplicationsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Career Code Job Portal Website Server Started');
})

app.listen(port, (res, req) => {
  console.log('Server Started at PORT: ', port);
})