# 🚀 Deployment Guide - FPL Power Meter Status

## Quick Start (Vercel - Recommended)

### 1. Prepare Your Repository
```bash
# Initialize git if not already done
git init
git add .
git commit -m "Initial commit"

# Create GitHub repository and push
git remote add origin https://github.com/yourusername/fpl-power-meter-status.git
git push -u origin main
```

### 2. Deploy to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Click "New Project"
4. Import your repository
5. Vercel will auto-detect the configuration
6. Click "Deploy"

**That's it!** Your app will be live at `https://your-app-name.vercel.app`

---

## Alternative Deployment Options

### Option 2: Railway (Full-Stack)

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Login and Deploy**:
   ```bash
   railway login
   railway init
   railway add postgresql  # Add database
   railway up
   ```

3. **Set Environment Variables**:
   ```bash
   railway variables set HEADLESS=true
   railway variables set NODE_ENV=production
   ```

### Option 3: Render

1. **Create render.yaml**:
   ```yaml
   services:
     - type: web
       name: fpl-backend
       env: node
       buildCommand: cd server && npm install
       startCommand: cd server && npm start
       envVars:
         - key: HEADLESS
           value: true
         - key: NODE_ENV
           value: production
     - type: web
       name: fpl-frontend
       env: static
       buildCommand: cd web && npm install && npm run build
       staticPublishPath: web/dist
   ```

2. **Deploy via Render Dashboard**

### Option 4: DigitalOcean App Platform

1. **Create app.yaml**:
   ```yaml
   name: fpl-power-meter
   services:
     - name: backend
       source_dir: server
       github:
         repo: yourusername/fpl-power-meter-status
         branch: main
       run_command: npm start
       environment_slug: node-js
       instance_count: 1
       instance_size_slug: basic-xxs
       envs:
         - key: HEADLESS
           value: true
         - key: NODE_ENV
           value: production
     - name: frontend
       source_dir: web
       github:
         repo: yourusername/fpl-power-meter-status
         branch: main
       build_command: npm install && npm run build
       run_command: npm run preview
       environment_slug: static
       static_sites:
         - name: frontend
           source_dir: web/dist
           routes:
             - path: /
   ```

2. **Deploy via DigitalOcean Dashboard**

---

## Environment Variables

Create these environment variables in your cloud platform:

```env
HEADLESS=true
NODE_ENV=production
PORT=8080
```

---

## Database Considerations

### For Production (Recommended)
- **PostgreSQL**: Use managed database service
- **Railway**: Built-in PostgreSQL
- **Vercel**: Vercel Postgres add-on
- **Render**: PostgreSQL add-on

### For Development
- **SQLite**: Works locally (already configured)

---

## Cost Comparison

| Platform | Free Tier | Paid Plans | Best For |
|----------|-----------|------------|----------|
| **Vercel** | ✅ Generous | $20/month | Quick deployment |
| **Railway** | ❌ | $5/month | Full-stack apps |
| **Render** | ✅ Limited | $7/month | Simple apps |
| **DigitalOcean** | ❌ | $12/month | Production apps |

---

## Post-Deployment Checklist

- [ ] Test single address lookup
- [ ] Test batch CSV upload
- [ ] Verify mobile responsiveness
- [ ] Check dark/light mode switching
- [ ] Test autocomplete functionality
- [ ] Verify CSV download works
- [ ] Check error handling

---

## Troubleshooting

### Common Issues:

1. **Playwright not working**:
   - Ensure `HEADLESS=true` is set
   - Check if platform supports Playwright

2. **Database errors**:
   - Verify database connection
   - Check if tables exist

3. **Build failures**:
   - Check Node.js version compatibility
   - Verify all dependencies are installed

4. **CORS issues**:
   - Ensure frontend and backend URLs are correct
   - Check CORS configuration

---

## Security Considerations

- [ ] Add rate limiting
- [ ] Implement input validation
- [ ] Add authentication if needed
- [ ] Use HTTPS (automatic on most platforms)
- [ ] Set up monitoring and logging

---

## Need Help?

- Check the platform's documentation
- Review error logs in the platform dashboard
- Test locally first with `npm run dev`
- Ensure all environment variables are set correctly
