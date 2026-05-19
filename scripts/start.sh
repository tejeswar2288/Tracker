#!/bin/bash

cd /var/www/tracker

pm2 restart tracker || pm2 start server.js --name tracker

pm2 save