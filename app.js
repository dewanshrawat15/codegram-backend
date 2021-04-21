const express = require("express");
const bodyParser = require("body-parser");
const utils = require("./utils");
const cors = require("cors");

let app = express();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(function middleware(req, res, next){
  var string = req.method + " " + req.path + " - " + req.ip;
  console.log(string);
  next();
});

app.get("/", (req, res) => {
  res.send("Welcome to SoundFlow, a music web app player");
});

app.get("/users", (req, res) => {
  res.json({
    "message": "An API endpoint to create users"
  });
});

app.get("/users/all", async (req, res) => {
  let result = await utils.getAllUsers();
  res.json({
    "result": result
  });
});

app.post("/users/create", async (req, res) => {
  const bodyData = req.body;
  let boolIfUserExists = await utils.checkIfUsernameExists(bodyData.username);
  if(boolIfUserExists){
    utils.createNewUser(req.headers.host, req, res);
  } else {
    res.json({
      "message": "Username with the same user already exists"
    });
  }
});

app.get("/users/delete/all", async (req, res) => {
  await utils.deleteRecords();
  await utils.deleteAuthTokens();
  res.json({
    "message": "All records deleted"
  });
});

app.post("/users/login", async (req, res) => {
  const bodyData = req.body;
  utils.loginUser(req.headers.host, bodyData.username, bodyData.password, res);
});

app.post("/users/password/update", async (req, res) => {
  const bodyData = req.body;
  utils.updatePassword(bodyData.username, bodyData.password, bodyData.newPassword, res);
});

app.get("/image/:id", async (req, res) => {
  const profileImageId = req.params.id;
  utils.fetchProfileImage(req, res, profileImageId);
});

app.post("/project/new", (req, res) => {
  utils.createNewProject(req, res);
});

app.get("/project/:id", async (req, res) => {
  utils.fetchProject(req, res);
});

app.get("/projectImage/:id", async (req, res) => {
  const projectImageId = req.params.id;
  utils.fetchProjectImage(req, res, projectImageId);
});

module.exports = app;