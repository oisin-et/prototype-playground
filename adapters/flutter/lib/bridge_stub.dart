// The prototype-playground kit: the playground bridge off the web (the desktop app),
// where there is no playground page to talk to.

bool get embedded => false;
void post(String message) {}
void listen(void Function(String data) onMessage) {}
