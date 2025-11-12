# Railway Deployment Troubleshooting

## Issue: Changes from GitHub not appearing in Railway

### Common Causes and Solutions

#### 1. **Wrong Root Directory** (Most Common)
Railway is likely looking at the repository root, but your service code is in the `railway-deploy/` subdirectory.

**Fix:**
1. Go to Railway Dashboard → Your Service → Settings → Source
2. Set **Root Directory** to: `railway-deploy`
3. Save and redeploy

#### 2. **Wrong Branch**
Railway might be watching a different branch than `main`.

**Fix:**
1. Go to Railway Dashboard → Your Service → Settings → Source
2. Ensure **Branch** is set to: `main`
3. Save and redeploy

#### 3. **Auto-Deploy Disabled**
Auto-deploy might be turned off, requiring manual deployment.

**Fix:**
1. Go to Railway Dashboard → Your Service → Settings → Source
2. Enable **Auto-Deploy** (should be ON)
3. Save settings

#### 4. **Manual Redeploy Needed**
Sometimes Railway needs a manual trigger after configuration changes.

**Fix:**
1. Go to Railway Dashboard → Your Service → Deployments
2. Click **"Redeploy"** or **"Deploy Latest"**

#### 5. **Build Failures**
Check if deployments are failing silently.

**Fix:**
1. Go to Railway Dashboard → Your Service → Deployments
2. Check the latest deployment logs
3. Look for any build or runtime errors

### Recommended Railway Configuration

**Service Settings:**
- **Root Directory:** `railway-deploy`
- **Branch:** `main`
- **Auto-Deploy:** Enabled
- **Build Command:** (Railway will detect from `package.json`)
- **Start Command:** `npm start` (or from `railway.json`)

### Quick Check Steps

1. ✅ Verify GitHub repository is connected
2. ✅ Check Root Directory is set to `railway-deploy`
3. ✅ Verify Branch is set to `main`
4. ✅ Confirm Auto-Deploy is enabled
5. ✅ Check latest deployment logs for errors
6. ✅ Manually trigger a redeploy if needed

### If Still Not Working

1. **Check Deployment Logs:**
   - Railway Dashboard → Service → Deployments → Latest Deployment → View Logs
   - Look for errors or warnings

2. **Verify GitHub Webhook:**
   - Railway Dashboard → Service → Settings → Source
   - Check if GitHub webhook is properly connected
   - You may see a "Reconnect" button if there's an issue

3. **Check Build Configuration:**
   - Verify `railway-deploy/railway.json` exists and is correct
   - Verify `railway-deploy/package.json` has correct start script
   - Check that `railway-deploy/src/index.js` exists

4. **Test Manual Deploy:**
   - Railway Dashboard → Service → Deployments
   - Click "Deploy Latest" to force a new deployment
   - Watch the logs to see what happens

### Railway CLI Alternative

If the dashboard doesn't work, you can use Railway CLI:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project (if not already linked)
railway link

# Deploy from the correct directory
cd railway-deploy
railway up
```

### Environment Variables

Make sure these are set in Railway:
- `NODE_ENV=production`
- `PORT=8080` (or Railway's assigned port)
- `HEADLESS=true` (if using Playwright)

