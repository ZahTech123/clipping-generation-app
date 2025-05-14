# Use an official Node.js runtime as a parent image
# Using alpine variant for smaller size
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install app dependencies
# Use --omit=dev to skip installing devDependencies
RUN npm install --omit=dev

# --- Install yt-dlp ---
# Install curl to download yt-dlp and python/pip if needed for yt-dlp or its features
# Also install ffmpeg for clipping
# Alpine package manager is apk
RUN apk add --no-cache curl python3 py3-pip ffmpeg

# Download the latest yt-dlp binary to /usr/local/bin for easy access
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp
# --- End Install yt-dlp ---

# Bundle app source
# Copy the api directory where the server and handler reside
COPY api/ ./api/

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variable for the port (optional, can be overridden)
ENV PORT=3000

# Define the command to run your app using CMD which defines your runtime
# This will run the Express server we created
CMD [ "node", "api/server.js" ] 