# Tech use in this 
- express and pg for interacting with postgresql
- cors for allowing communication between frontend and backend at different ports
- redis for storing access code to authenticate the user has signed in or not
# Installation 
**Generating server config file:**
<br>
``npm init -y``

**Installing express, cors and pg:**
<br>
``npm install cors express pg``

**Installing redis**
<br>
``bash

sudo apt-get install redis-server 

sudo systemctl enable redis

sudo systemctl start redis``
