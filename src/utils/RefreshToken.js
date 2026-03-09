const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const generateTokens = (user)=>{

  const tokenId = uuidv4();

  const accessToken = jwt.sign(
    {
      userId:user._id,
      role:user.role
    },
    process.env.JWT_SECRET,
    {expiresIn:"15m"}
  );

  const refreshToken = jwt.sign(
    {
      userId:user._id,
      tokenId
    },
    process.env.JWT_REFRESH_SECRET,
    {expiresIn:"7d"}
  );

  return {accessToken,refreshToken,tokenId};

};

module.exports = generateTokens;