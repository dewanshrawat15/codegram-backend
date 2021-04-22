const mongoose = require('mongoose');
const ObjectID = require('mongodb').ObjectID;
const Schema = mongoose.Schema;
const crypto = require('crypto');
const multer = require("multer");
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { Readable } = require('stream');
require('dotenv').config();

const conn = mongoose.connect(
    process.env.MONGO_URI,
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useFindAndModify: false
    }
);

mongoose.connection.on('connected', () => {
    console.log('Connected to MongoDB @ 27017');
});
  
let UserSchema = new Schema({
    username: {type: String, required: true},
    firstName: {type: String, required: true},
    lastName: {type: String, required: true},
    hash: {type: String, required: true},
    salt: {type: String, required: true},
    profileImage: {type: String, required: true}
});

let AuthTokenSchema = new Schema({
    authToken: {type: String, required: true},
    username: {type: String, required: true}
});

let ProjectSchema = new Schema({
    title: {type: String, required: true},
    details: {type: String, required: true},
    image: {type: String, required: true},
    date: {type: String, required: true},
    user: {type: String, required: true},
    likes: {type: Number, default: 0}
})

let User = mongoose.model("User", UserSchema);
let AuthToken = mongoose.model("Auth Token", AuthTokenSchema);
let Project = mongoose.model("Project", ProjectSchema);

const validatePassword = (password, salt, userHash) => {
    let hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return userHash === hash;
}

const createNewUser = (host, req, res) => {
    const storage = multer.memoryStorage();
    const upload = multer({
        storage: storage,
        limits: {
            fields: 1,
            fileSize: 6000000,
            files: 1,
            parts: 2
        }
    });

    upload.single('profileImage')(req, res, (err) => {
        const data = JSON.parse(req.body.data);
        if (err) {
            return res.status(400).json({ message: "Upload Request Validation Failed" });
        }
        const readableTrackStream = new Readable();
        readableTrackStream.push(req.file.buffer);
        readableTrackStream.push(null);
        let bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: "profileImages"
        });
        let uploadStream = bucket.openUploadStream(data["username"]);
        let profileImageId = uploadStream.id;
        readableTrackStream.pipe(uploadStream);

        uploadStream.on('error', () => {
            return res.status(500).json({ message: "Error uploading file" });
        });

        uploadStream.on('finish', () => {
            const username = data["username"];
            const firstName = data["firstName"];
            const lastName = data["lastName"];
            const password = data["password"];

            let salt = crypto.randomBytes(16).toString('hex');
            let hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

            let newUser = new User({
                username: username,
                firstName: firstName,
                lastName: lastName,
                salt: salt,
                hash: hash,
                profileImage: profileImageId
            });

            newUser.save(function(err, data){
                if (err){
                    res.json({
                        "message": err
                    });
                }
                else{
                    const firstName = data.firstName;
                    const lastName = data.lastName;
                    const profileImageUrl = "http://" + host + "/image/" + data.profileImage;
                    let authToken = jwt.sign(username, process.env.TOKEN_SECRET);
                    let newAuthToken = new AuthToken({
                        username: username,
                        authToken: authToken
                    });
                    newAuthToken.save(function(err, data){
                        if(err){
                            res.json({
                                "message": err
                            });
                        } else {
                            res.json({
                                "message": "New user created",
                                "data": {
                                    "authToken": authToken,
                                    "username": username,
                                    "firstName": firstName,
                                    "lastName": lastName,
                                    "profileImageUrl": profileImageUrl
                                }
                            });
                        }
                    });
                }
            });
        });
    });
}

const fetchProfileImage = (req, res, profileImage) => {
    let imageID;
    try {
        imageID = new ObjectID(profileImage);
    } catch (err) {
        return res.status(400).json({ message: "Invalid trackID in URL parameter. Must be a single String of 12 bytes or a string of 24 hex characters" }); 
    }
    let bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: "profileImages"
    });
    let downloadStream = bucket.openDownloadStream(imageID);
    downloadStream.on('data', (chunk) => {
        res.write(chunk);
    });
    downloadStream.on('error', () => {
        res.sendStatus(404);
    });
    downloadStream.on('end', () => {
        res.end();
    });
}

const loginUser = (host, username, password, res) => {
    User.findOne({ username: username }, function(err, user){
        if(err){
            console.error(err);
        }
        if(user === null){
            res.status(400).json({
                message: "User does not exist",
                login: false
            });
        }
        else{
            const validateUser = validatePassword(password, user.salt, user.hash);
            if(validateUser){
                AuthToken.findOne({ username: username }, function(err, authToken){
                    if(err){
                        console.error(err);
                    }
                    if(authToken === null){
                        res.status(400).json({
                            "message": "An internal error occured."
                        })
                    }
                    else{
                        res.status(201).json({
                            message: "User login successful",
                            data: {
                                username: user.username,
                                authToken: authToken.authToken,
                                firstName: user.firstName,
                                lastName: user.lastName,
                                profileImageUrl: "http://" + host + "/image/" + user.profileImage
                            }
                        });
                    }
                })
            }
            else{
                res.status(400).json({
                    message: "Wrong password",
                    login: false
                });
            }
        }
    });
}

const updatePassword = async (username, password, newPassword, res) => {
    User.findOne({ username: username }, function(err, user){
        if(err){
            console.error(err);
        }
        if(user === null){
            res.status(400).json({
                "message": "User does not exist"
            })
        }
        else{
            const validateUser = validatePassword(password, user.salt, user.hash);
            if(validateUser){
                let salt = crypto.randomBytes(16).toString('hex');
                let hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');
                user.salt = salt;
                user.hash = hash;
                user.save(function(err, data){
                    if(err){
                        console.error(err);
                        res.status(400).json({
                            "message": "An error occured"
                        });
                    } else {
                        res.status(201).json({
                            "message": "Password updated"
                        });
                    }
                });
            }
            else{
                res.status(400).json({
                    "message": "User cannot be validated"
                });
            }
        }
    });
}

const checkIfUsernameExists = async (username) => {
    let records = await User.find({
        username: username
    });
    if (records.length === 0){
        return true;
    }
    else{
        return false;
    }
}

const getUser = async () => {
    let records = await User.find();
    let userRecords = [];
    records.forEach(element => {
        userRecords.push(element.toObject());
    });
    return userRecords;
}

const deleteAllRecords = async () => {
    await User.remove();
}

const deleteAuthTokens = async () => {
    await AuthToken.remove();
}

const createNewProject = (req, res) => {
    const authToken = req.headers.authorization;
    AuthToken.findOne({ authToken: authToken }, (err, authData) => {
        if(err){
            res.json({
                "message": "error"
            });
        } else {
            const username = authData.username;
            const storage = multer.memoryStorage();
            const upload = multer({
                storage: storage,
                limits: {
                    fields: 1,
                    fileSize: 6000000,
                    files: 1,
                    parts: 2
                }
            });

            upload.single('projectImage')(req, res, (err) => {
                const data = JSON.parse(req.body.data);
                if (err) {
                    return res.status(400).json({ message: "Upload Request Validation Failed" });
                }
                const readableTrackStream = new Readable();
                readableTrackStream.push(req.file.buffer);
                readableTrackStream.push(null);
                let bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
                    bucketName: "projectImage"
                });
                let uploadStream = bucket.openUploadStream(data["title"]);
                let profileImageId = uploadStream.id;
                readableTrackStream.pipe(uploadStream);

                uploadStream.on('error', () => {
                    return res.status(500).json({ message: "Error uploading file" });
                });

                uploadStream.on('finish', () => {
                    const title = data["title"];
                    const details = data["details"];
                    const date = new Date().toDateString();

                    const newProject = Project({
                        title: title,
                        details: details,
                        date: date,
                        image: profileImageId,
                        user: username
                    })

                    newProject.save(function(err, data){
                        if (err){
                            res.json({
                                "message": err
                            });
                        }
                        else{
                            res.json({
                                "message": data
                            });
                        }
                    });
                });
            });
        }
    });
}

const fetchProjectImage = (req, res, profileImage) => {
    let imageID;
    try {
        imageID = new ObjectID(profileImage);
    } catch (err) {
        return res.status(400).json({ message: "Invalid trackID in URL parameter. Must be a single String of 12 bytes or a string of 24 hex characters" }); 
    }
    let bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: "projectImage"
    });
    let downloadStream = bucket.openDownloadStream(imageID);
    downloadStream.on('data', (chunk) => {
        res.write(chunk);
    });
    downloadStream.on('error', () => {
        res.sendStatus(404);
    });
    downloadStream.on('end', () => {
        res.end();
    });
}

const fetchProject = (req, res) => {
    const projectID = req.params.id;
    const params = {
        "_id": projectID
    };
    Project.findOne(params, (err, data) => {
        if(err){
            res.json({
                "message": err
            })
        } else {
            const host = req.headers.host;
            res.json({
                "data": {
                    title: data.title,
                    details: data.details,
                    date: data.date,
                    username: data.user,
                    likes: data.likes,
                    projectImage: "http://" + host + "/projectImage/" + data.image
                }
            })
        }
    })
}

const getAllProjects = (host, req, res) => {
    Project.find({}, (err, data) => {
        if(err){
            res.json({
                "message": err
            })
        } else {
            let projects = [];
            data.forEach(element => {
                let projectImageUrl = "http://" + host + "/projectImage/" + element.image;
                element['image'] = projectImageUrl;
                projects.push(element);
            });
            res.json({
                "message": "Fetched all projects successfully",
                "data": projects
            })
        }
    })
}

const updateProjectNumberOfLikes = (req, res, _id) => {
	const params = {
		_id: _id
	}
    Project.findOneAndUpdate(params, {
        "$inc": {
            "likes": 1
        }
    }, (err, data) => {
        if(err){
            res.status(400).json({
                "error": err
            })
        } else {
            Project.findOne(params, (err, data) => {
                if(err){
                    res.status(400).json({
                        "error": err
                    })
                } else {
                    res.json({
                        "data": data
                    })
                }
            })
        }
    })
}

exports.createNewUser = createNewUser;
exports.getAllUsers = getUser;
exports.checkIfUsernameExists = checkIfUsernameExists;
exports.deleteRecords = deleteAllRecords;
exports.loginUser = loginUser;
exports.updatePassword = updatePassword;
exports.deleteAuthTokens = deleteAuthTokens;
exports.fetchProfileImage = fetchProfileImage;
exports.createNewProject = createNewProject;
exports.fetchProjectImage = fetchProjectImage;
exports.fetchProject = fetchProject;
exports.getAllProjects = getAllProjects;
exports.updateProjectNumberOfLikes = updateProjectNumberOfLikes;