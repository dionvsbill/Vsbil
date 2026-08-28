import "dotenv/config";
import { supabase } from "./config/supabase.js";

async function testSupabase() {
  const { error } = await supabase
    .from("users")
    .select("id")
    .limit(1);

  if (error) {
    console.error("Supabase connection failed:", error.message);
    process.exit(1);
  }

  console.log("Supabase connection successful!");
}

testSupabase();
