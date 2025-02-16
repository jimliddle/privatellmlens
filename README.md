# PrivateLLMLens
This provide A Zero-Server Web Interface for use with Ollama local LLM's. Please star the repository if you like it.

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

![image](https://github.com/user-attachments/assets/71efcecf-0955-4e22-b076-4c4236e2250b)


This is really useful when you are checking out the capabilities of the different models.

Each of the models can easily be changed from the model dropdown in the bottom right of the screen. This uses the Ollama Tags feature to be able to interrogate and populate the models.

![image](https://github.com/user-attachments/assets/08ce21d2-a399-4342-b3e5-0e5b105facb2)

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

Another things I wanted to be able to do was to at least be able to handle small file attachment inputs. This is something I have implemented for .txt and .pdf files.

To demonstrate how this works I copied the Wikipedia page for Moby Dick and save it to both a text file and a pdf file.

We attach the txt file and ask it to provide a brief summary using one the smaller QWEN 2.5 0.5b models. 


![image](https://github.com/user-attachments/assets/f4eada29-9eae-4266-81d6-d36e68803137)


The response is a decent summary of the content provided. There is no vector DB or RAG here so technically all we are doing is parsing the text and pre-appending it to the input prompt. The merged prompt  includes a clear delimiter indicating where the attached content starts and ends. 

We can also do the same with the PDF version of the same content:

Here are we are doing something similar but we are dynamically loading pdf.js (used under the terms of its Apache 2.0 license) to extract the content and then append to the prompt the same way as we are doing with the text attachments.

![image](https://github.com/user-attachments/assets/b2fb4f97-b2ef-40c3-a285-d5014231bd6f)

As you can see the response is much elongated compared to the shorter summary we received from the text response, even thought the content is the same. Why ? The PDF extraction process often produces text with additional formatting, headings, or slight rewording. This enriched prompt can cause the model to generate a response that incorporates more general knowledge. In contrast, the plain text file provides a more direct, unmodified input, so the response is more closely tied to that text.

I have also implemented an experimental feature, which is being able to leverage the prior output to ask another question. This takes the prior output and inputs it as a 'prior conversation' along with the prompt input:

![image](https://github.com/user-attachments/assets/65244cd4-c2db-405a-93e4-8b4f05fc14a6)
