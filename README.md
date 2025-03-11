# PrivateLLMLens
This provide A Zero-Server Web Interface for use with Ollama local LLM's. Also works on mobile if Ollama has been installed using Termux. Please star the repository if you like it.

So what is a zero-server web interface ? It is just a HTML file that you can double-click to launch (and then bookmark for subsequent use). It's served as a file through the web browser rather than through http/https.

### Configuration
There is not a lot to configure but you do need to setup the Ollama Origin flag. The Ollama Origins setting is used to whitelist which web origins (domains, protocols, ports) are permitted to access the Ollama server's API. This prevents unauthorized websites from making requests and helps mitigate cross-site request forgery (CSRF) vulnerabilities. In essence, it ensures that only trusted sources (like our local  environment) can interact with your Ollama instance.

#### Mac
On Mac you should enter the following for the command prompt:

<code> launchctl setenv OLLAMA_ORIGINS "*" </code>

After you have done this restart Ollama and verify it is available (http://localhost:11434) and then load the web page
The tell tale that all is well is that models are loaded in the model configuration in the bottom right.
If you want the environment variable to persist across system restarts, you can use a Mac LaunchAgent

#### Windows
On Windows open search and type 'env' and you should see 'edit the system environment variables appear. Click this and the 'System Properties; window will appear. Click the 'Environment Variables' button. 

<code>Create a new User variable called OLLAMA_ORIGINS with a value of * </code> 

The cleanest way for this to stick is to reboot the windows machine. This will now stick between subsequent reboots.

### Overview

This started out as something that would let me test the different models and response times but at some point I realized it would be pretty neat to be able to use this as an easy way to interact with Ollama without ever having to fire up the command prompt. 

Below you can see the interface and you can see that every time we interact with a model the model name and response time are noted:

![Screenshot 2025-03-01 153109](https://github.com/user-attachments/assets/00c2770e-a72e-4bb0-8a0d-ef3e2b5d04f0)

This is really useful when you are checking out the capabilities of the different models.

Each of the models can easily be changed from the model dropdown in the bottom right of the screen. This uses the Ollama Tags feature to be able to interrogate and populate the models.

![Screenshot 2025-03-01 163559](https://github.com/user-attachments/assets/bd9feb03-ea14-4591-bda3-cf9c837f8773)

The last used model will be the auto-selected model next time PrivateLLMLens is refreshed or loaded.

Themes can be switched between light and dark

![Screenshot 2025-03-01 152320](https://github.com/user-attachments/assets/3d388f21-af27-4222-95f6-2d03f625b43f)


So if this is a single web page where is the data being persisted I hear you ask. Well, to keep things very simple and to honor the single page paradigm it is taking advantage of the IndexedDB capabilities from the browser. 

IndexedDB is a low-level API built into modern browsers that provides a transactional database system for storing large amounts of structured data on the client side. It lets you store key-value pairs, and can handle complex objects including files and blobs. Because it supports indexing and transactions, you can efficiently retrieve and update your data. IndexedDB is asynchronous, which helps keep your application responsive even when working with large datasets.

In terms of compatibility, IndexedDB is supported by all major modern browsers such as Chrome, Firefox, Safari, Edge, and Opera. This makes it a popular choice for offline storage and caching in web applications.

IndexedDB version one refers to the initial, simpler schema that many early web apps used—typically with a single object store for key-value pairs. IndexedDB version two (as used in rhis code) builds on that by allowing schema migrations through a version number. In this implementation, version 2 enabled me to create multiple object stores (such as separate stores for threads and messages) and add indexes (such as the "threadId" index), making it easier to manage multi-threaded chat data.

In the interface you can see at the bottom a 'Reset IndexedDB' link. In the event IndexedDB every becomes corrupted you can use this. It simply runs some Javascript to delete the IndexedDB in cache and re-constructs it.

Threads enables the user to create different workspaces, for example you could create one for text models and another for vision models:

![image](https://github.com/user-attachments/assets/36c26aeb-2a28-4929-bd40-130ec1ef47b4)


Because Ollama supports vision models we can select a vision model in our workspace and ask it about an image.

![image](https://github.com/user-attachments/assets/208a7c92-6697-4df0-b81c-fcb3325cb4cc)

In this case we can see the Lllava-Phi3 image model (the fastest from my testing) took 125 seconds to interrogate the image and respond (I could have no doubt speeded this up substantially by using my external GPU). The image and the response are cached in Indexed DB and will be available in the workspace until you 'clear all messages' or delete the workspace.

From a technical viewpoint we read the image file as a base64 data URL (with the data URL prefix removed), we strip the prefix, and send it to Ollama using the "images" key.

This is a nice way to be able to use and test the various images models locally.

Another things I wanted to be able to do was to at least be able to handle small file attachment inputs. This is something I have implemented for text, pdf, csv, html, python and JSON files.

To demonstrate how this works I copied the Wikipedia page for Moby Dick and save it to both a text file and a pdf file.

We attach the txt file and ask it to provide a brief summary using one the smaller Lllama 3.2 1b models. 

![Screenshot 2025-03-01 170043](https://github.com/user-attachments/assets/3a6f6b84-1efe-4a69-a5ed-fd2953636dfe)

The response is a decent summary of the content provided. There is no vector DB or RAG here so technically what we are doing is parsing the text and pre-appending it to the input prompt. The merged prompt  includes a clear delimiter indicating where the attached content starts and ends. 

We can also do the same with the PDF version of the same content:

Here are we are doing something similar but we are dynamically loading pdf.js (used under the terms of its Apache 2.0 license) to extract the content, chunk it, summarize each chunk, and then append to the prompt the same way as we are doing with the text attachments.

![Screenshot 2025-03-01 170424](https://github.com/user-attachments/assets/d1b81234-f1e7-4d0f-b4e3-4df189d5e1f6)

I have also implemented a feature, which is being able to leverage the prior output to ask another question. This takes the prior output and inputs it as a 'prior conversation' along with the prompt input:

![Screenshot 2025-03-01 170925](https://github.com/user-attachments/assets/bc3a25dc-96b8-40b9-b367-101274fb5de5)

The 'dont summarize' feature prevents files being chunked and summarized when being sent to Ollama. This is useful if you are dealing with code files, JSON files or CSV files.

An example of using this with a Python code file can be seen below:

![Screenshot 2025-03-01 171623](https://github.com/user-attachments/assets/78cb9a59-c03d-48e7-b9b4-5eaade8fb907)

In the summarization mode (the default) we read each chunk, call the summarization API, and then combine the summaries. In the 'Don’t Summarize' mode we still read the file in chunks (to avoid loading huge files into memory at once), but we skip the API calls and simply concatenate all chunk text into one final raw string.

Chunking helps with memory problems because it prevents PrivateLLMSLens from loading the entire file into memory at once. Instead, we:

(i)   Read and process the file in small slices (chunks).
(ii)  Handle each chunk (either summarizing it or concatenating it) and then move on to the next chunk.
(iii) Never store the entire file’s data in memory simultaneously.

Essentially, each chunk is briefly in memory during its processing, and then it’s discarded. The only data that persists between chunks is the (relatively small) partial result (either a short summary or the incrementally growing concatenated text). This is much more memory-efficient than loading the entire file at once—especially as we are summarizing each chunk into something far smaller.

The chunk size setting can be controlled from the settings section:

![Screenshot 2025-03-11 182357](https://github.com/user-attachments/assets/19f3596a-c093-419e-962f-c6eb5548f192)


Note that currently exceeding the context window usually means you’ll get suboptimal or failed results and you should consider a model with a larger context window. One thing I am looking at for a future release is further hierarchical summarization when hitting context window limits.

Also note from the screenshot above that the Ollama endpoint can be changed in the settings, if your Ollama deployment is not on your local laptop or mobile and you want to use PrivateLLMLens.

Two extenal services are supported (API keys need to be entered in the settings):

Perplexity AI Search

![Screenshot 2025-03-11 184250](https://github.com/user-attachments/assets/12034c0e-4a4c-4eb1-985b-f04f74287eb4)

OpenAI Search

![Screenshot 2025-03-11 180300](https://github.com/user-attachments/assets/03612a98-e3f5-4045-ad36-bd78e6eef949)









