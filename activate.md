01_clean\Scripts\activate
------------------------------------------------

v_2_gemini wla hain jissme apna easy 100 percentage tha aur uss same kb pe medium ka 11 shi aur 16 glt abhi 100 percentage wala kb hain voh hain 41_E_v1 hain 

12 galat wali json v_1 gemini hain isska kb 29 wala hain 

jo sabse phela wala jisspe 50% wala system tha na voh tera hain kb_v3 hain 

json toh saari id krdo bas v_7 

uvicorn main:app --host 0.0.0.0 --port 8001 --reload


Example (last 30 days): created_at >= CURRENT_DATE - interval '30 days' - interval '5 hours 30 minutes' AND created_at < CURRENT_DATE + interval '1 day' - interval '5 hours 30 minutes'



tag for correct incorrect is not yet implemented flow is fixed 
analysis upar result neeche 
impprove logic upar csv save to memory stars ek line mein 





Step 1: Initialize Git First
bash
# Navigate to your project directory
cd C:\Users\mohit\OneDrive\Desktop\FRESH START\DataWhisper
 
# Initialize Git repository
git init
Step 2: Initial Setup (No Commits Yet)
bash
# Check status (will show untracked files)
git status
 
# Add all files to create initial state
git add .
 
# Make initial commit of your current code
git commit -m "Initial commit: Original DataWhisper codebase"
Step 3: Now Use the Stash Workflow
bash
# Create feature branch
git checkout -b feature/mcq-query-refinement
 
# Now you can implement the MCQ feature changes
# (Add the new files, modify existing ones, etc.)
 
# When you want to switch back to original:
git checkout main  # Back to original clean code
 
# Return to MCQ work:
git checkout feature/mcq-query-refinement



No, it will **not** commit to main. Here's why:

When you run `git checkout -b feature/mcq-query-refinement`, you've switched to the new branch. Any commits you make after that point go to `feature/mcq-query-refinement` only.

Think of it like this:

```
main
  └── Initial commit  ← stays here, untouched

feature/mcq-query-refinement  ← you are HERE
  └── Initial commit (inherited)
  └── your new MCQ commits go here
```

So your workflow is safe:

```bash
git checkout -b feature/mcq-query-refinement

# make your changes...

git add .
git commit -m "Add MCQ query refinement"   # ← goes to feature branch ONLY

git checkout main   # main is still clean, no MCQ changes here
```

Main only gets your MCQ changes if you explicitly merge or rebase, like:

```bash
git checkout main
git merge feature/mcq-query-refinement   # only then does main get the changes
```

Until you do that merge, your branches are completely independent.



 Step 1 — Install new backend dependencies                                                                                                                                                                                                                                                                       
  cd "C:\Users\mohit\OneDrive\Desktop\FRESH START\DataWhisper\text_to_sql_api"                                                                           
  pip install -r requirements.txt

  ---
  Step 2 — Generate JWT secret and add to .env

  python -c "import secrets; print(secrets.token_hex(32))"

  Copy the output and open .env, replace REPLACE_WITH_GENERATED_SECRET with it.

  ---
  Step 3 — Run schema.sql on your auth DB

  cd "C:\Users\mohit\OneDrive\Desktop\FRESH START\DataWhisper"
  psql "postgresql://postgres.hqtrvqosendjpqosqknw:%23%23ChatWithDB%20%23@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" -f schema.sql

  Replace ... with your actual AUTH_DB_URL from .env. Or paste the contents of schema.sql directly into your Supabase SQL editor.

  ---
  Step 4 — Seed the 6 super_admin users

  cd "C:\Users\mohit\OneDrive\Desktop\FRESH START\DataWhisper"
  python seed_users.py

  ---
  Step 5 — Start the backend

  cd "C:\Users\mohit\OneDrive\Desktop\FRESH START\DataWhisper\text_to_sql_api"
  uvicorn main:app --host 0.0.0.0 --port 8001 --reload

  ---
  Step 6 — Start the frontend

  cd "C:\Users\mohit\OneDrive\Desktop\FRESH START\DataWhisper\frontend"
  npm install
  npm run dev

  ---
  Step 7 — Verify

  Open http://localhost:5173 — you should see the login page. Login with:
  - Username: mohit.kapoor@degreefyd.com
  - Password: mohit.kapoor@degreefyd.com