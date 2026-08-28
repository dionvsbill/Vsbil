import "dotenv/config";
import app from "./app.js";
const PORT=Number(process.env.PORT)||3000;
app.listen(PORT,()=>console.log(`VSBIL production API listening on http://localhost:${PORT}`));
