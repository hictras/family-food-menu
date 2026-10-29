self.addEventListener("push",event=>{
  const data=event.data?event.data.json():{};
  event.waitUntil(
    self.registration.showNotification(data.title||"Family Food Menu",{
      body:data.body||"Check the family menu.",
      data:{url:data.url||"/"}
    })
  );
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url||"/"));
});
